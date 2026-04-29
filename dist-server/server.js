/**
 * Custom Next.js server that adds a WebSocket endpoint at /ws.
 *
 * Each WebSocket connection represents one meeting session.
 * Protocol:
 *   Client → Server  text:   { type: "start", sampleRate: number } | { type: "stop" }
 *   Client → Server  binary: raw PCM audio chunks (Int16, mono)
 *   Server → Client  text:   ServerMessage (see lib/ws-protocol.ts)
 */
import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { DeepgramStreamer } from "./lib/deepgram.js";
import { TranscriptBuffer } from "./lib/transcript-buffer.js";
import { MeetingSummarizer } from "./lib/summarizer.js";
const PORT = parseInt(process.env.PORT ?? "3000");
const SUMMARY_INTERVAL_MS = parseInt(process.env.SUMMARY_INTERVAL_MS ?? "30000");
const MIN_WORDS_FOR_SUMMARY = parseInt(process.env.MIN_WORDS_FOR_SUMMARY ?? "50");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? "";
if (!ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY is not set");
if (!DEEPGRAM_API_KEY)
    throw new Error("DEEPGRAM_API_KEY is not set");
// ---------------------------------------------------------------------------
// Next.js
// ---------------------------------------------------------------------------
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
await app.prepare();
// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
});
const wss = new WebSocketServer({ noServer: true });
const nextUpgradeHandler = app.getUpgradeHandler();
httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/");
    if (pathname === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    }
    else {
        // Forward _next/* and other paths to Next.js (needed for Turbopack HMR in dev).
        nextUpgradeHandler(req, socket, head);
    }
});
// ---------------------------------------------------------------------------
// Per-connection meeting session
// ---------------------------------------------------------------------------
wss.on("connection", (ws) => {
    console.log("[ws] New meeting session");
    const buffer = new TranscriptBuffer();
    const summarizer = new MeetingSummarizer(ANTHROPIC_API_KEY);
    const streamer = new DeepgramStreamer({ apiKey: DEEPGRAM_API_KEY });
    let summaryTimer = null;
    let isSummarizing = false;
    let sessionEnded = false;
    function send(msg) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }
    async function runInterimSummary() {
        if (isSummarizing || sessionEnded)
            return;
        const words = buffer.getWordCount();
        if (words < MIN_WORDS_FOR_SUMMARY)
            return;
        isSummarizing = true;
        send({ type: "status", message: `Summarizing ${words} words…` });
        try {
            const { summary, usage } = await summarizer.summarize(buffer.getFinalTranscript(), "incremental");
            console.log(`[ws] Interim summary (${usage.inputTokens}→${usage.outputTokens} tokens, ${usage.cacheReadTokens} cached)`);
            send({ type: "summary", data: summary, label: "Interim", isFinal: false, wordCount: words });
        }
        catch (err) {
            send({ type: "error", message: `Interim summary failed: ${String(err)}` });
        }
        finally {
            isSummarizing = false;
        }
    }
    async function endSession() {
        if (sessionEnded)
            return;
        sessionEnded = true;
        if (summaryTimer)
            clearInterval(summaryTimer);
        streamer.finish();
        // Wait for any in-flight summary to complete.
        while (isSummarizing)
            await sleep(200);
        if (buffer.isEmpty()) {
            send({ type: "done" });
            return;
        }
        send({ type: "status", message: "Generating final summary…" });
        isSummarizing = true;
        try {
            const { summary, usage } = await summarizer.summarize(buffer.getFinalTranscript(), "final");
            console.log(`[ws] Final summary (${usage.inputTokens}→${usage.outputTokens} tokens)`);
            send({ type: "summary", data: summary, label: "Final", isFinal: true, wordCount: buffer.getWordCount() });
        }
        catch (err) {
            send({ type: "error", message: `Final summary failed: ${String(err)}` });
        }
        finally {
            isSummarizing = false;
            send({ type: "done" });
        }
    }
    // Deepgram events
    streamer.on("connected", () => {
        send({ type: "connected" });
        summaryTimer = setInterval(runInterimSummary, SUMMARY_INTERVAL_MS);
    });
    streamer.on("transcript", ({ text, isFinal }) => {
        if (isFinal) {
            buffer.addFinal(text);
        }
        else {
            buffer.updateInterim(text);
        }
        send({ type: "transcript", text, isFinal });
    });
    streamer.on("utterance_end", () => buffer.clearInterim());
    streamer.on("error", (err) => {
        console.error("[ws] Deepgram error:", err.message);
        send({ type: "error", message: `Deepgram error: ${err.message}` });
    });
    streamer.on("closed", () => endSession().catch(console.error));
    // Client messages
    ws.on("message", (data, isBinary) => {
        if (isBinary) {
            // Raw PCM audio chunk — forward directly to Deepgram.
            streamer.send(data);
            return;
        }
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "start") {
                streamer.connect();
            }
            else if (msg.type === "stop") {
                endSession().catch(console.error);
            }
        }
        catch {
            // ignore malformed text frames
        }
    });
    ws.on("close", () => {
        console.log("[ws] Session closed");
        endSession().catch(console.error);
    });
    ws.on("error", (err) => console.error("[ws] Socket error:", err.message));
});
httpServer.listen(PORT, () => {
    console.log(`\n🎙️  Meeting Summarizer`);
    console.log(`   http://localhost:${PORT}\n`);
});
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

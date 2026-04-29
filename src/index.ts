import "dotenv/config";
import { createReadStream } from "fs";
import { DeepgramStreamer, type TranscriptEvent } from "./deepgram.js";
import { TranscriptBuffer } from "./transcript-buffer.js";
import { MeetingSummarizer } from "./summarizer.js";
import type { MeetingSummary } from "./schemas.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? "";
const SUMMARY_INTERVAL_MS = Number(process.env.SUMMARY_INTERVAL_MS ?? 30_000);
const MIN_WORDS_FOR_SUMMARY = Number(process.env.MIN_WORDS_FOR_SUMMARY ?? 50);

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function printBanner(text: string): void {
  const line = "─".repeat(62);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function printSummary(summary: MeetingSummary, label: string): void {
  printBanner(`📋  ${label}`);

  console.log(`\n📌  ${summary.title}`);
  console.log(`\n${summary.executive_summary}`);

  if (summary.topics_discussed.length > 0) {
    console.log("\n🗂   Topics Discussed");
    summary.topics_discussed.forEach((t) => console.log(`    • ${t}`));
  }

  if (summary.key_decisions.length > 0) {
    console.log("\n✅  Key Decisions");
    summary.key_decisions.forEach((d) => console.log(`    • ${d}`));
  }

  if (summary.action_items.length > 0) {
    console.log("\n📌  Action Items");
    summary.action_items.forEach((a) => {
      const owner = a.owner ? ` → ${a.owner}` : "";
      const deadline = a.deadline ? ` [${a.deadline}]` : "";
      const priority = a.priority ? ` (${a.priority})` : "";
      console.log(`    • ${a.task}${owner}${deadline}${priority}`);
    });
  }

  if (summary.open_questions.length > 0) {
    console.log("\n❓  Open Questions");
    summary.open_questions.forEach((q) => console.log(`    • ${q}`));
  }

  if (summary.next_steps.length > 0) {
    console.log("\n🔜  Next Steps");
    summary.next_steps.forEach((s) => console.log(`    • ${s}`));
  }

  if (summary.participants_mentioned.length > 0) {
    console.log(`\n👥  Participants: ${summary.participants_mentioned.join(", ")}`);
  }

  console.log("─".repeat(62) + "\n");
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY is not set");

  // Optional: path to a raw PCM file for testing; defaults to stdin (mic pipe).
  // Audio must be: linear16 encoding, 16 kHz, mono.
  // Convert with: ffmpeg -i input.wav -ar 16000 -ac 1 -f s16le output.pcm
  const audioFilePath = process.argv[2];

  const buffer = new TranscriptBuffer();
  const summarizer = new MeetingSummarizer(ANTHROPIC_API_KEY);
  const streamer = new DeepgramStreamer({ apiKey: DEEPGRAM_API_KEY });

  let isSummarizing = false;
  let summaryTimer: ReturnType<typeof setInterval> | null = null;
  let shutdownStarted = false;

  // ------------------------------------------------------------------
  // Interim summary loop — fires every SUMMARY_INTERVAL_MS
  // ------------------------------------------------------------------
  async function runInterimSummary(): Promise<void> {
    if (isSummarizing || shutdownStarted) return;

    const words = buffer.getWordCount();
    if (words < MIN_WORDS_FOR_SUMMARY) {
      process.stdout.write(
        `\r⏳  ${words}/${MIN_WORDS_FOR_SUMMARY} words — waiting for more transcript…`
      );
      return;
    }

    isSummarizing = true;
    process.stdout.write("\n");
    console.log(`\n🤖  Generating interim summary (${words} words)…`);

    try {
      const { summary, usage } = await summarizer.summarize(
        buffer.getFinalTranscript(),
        "incremental"
      );
      printSummary(summary, "Interim Summary");
      console.log(
        `    💰  tokens: ${usage.inputTokens} in / ${usage.outputTokens} out` +
          (usage.cacheReadTokens > 0 ? ` / ${usage.cacheReadTokens} cached` : "")
      );
    } catch (err) {
      console.error("\n❌  Interim summary failed:", err);
    } finally {
      isSummarizing = false;
    }
  }

  // ------------------------------------------------------------------
  // Graceful shutdown — generate final summary then exit
  // ------------------------------------------------------------------
  async function shutdown(reason: string): Promise<void> {
    if (shutdownStarted) return;
    shutdownStarted = true;

    process.stdout.write("\n");
    console.log(`\n⚠️   ${reason} — finishing up…`);

    if (summaryTimer) clearInterval(summaryTimer);
    streamer.finish();

    if (buffer.isEmpty()) {
      console.log("No transcript recorded.");
      process.exit(0);
    }

    // Wait for any in-flight interim summary to complete before the final one.
    while (isSummarizing) {
      await sleep(200);
    }

    console.log("\n🤖  Generating final summary…");
    try {
      const { summary, usage } = await summarizer.summarize(
        buffer.getFinalTranscript(),
        "final"
      );
      printSummary(summary, "FINAL MEETING SUMMARY");
      console.log(
        `    💰  tokens: ${usage.inputTokens} in / ${usage.outputTokens} out` +
          (usage.cacheReadTokens > 0 ? ` / ${usage.cacheReadTokens} cached` : "")
      );
    } catch (err) {
      console.error("❌  Final summary failed:", err);
    }
    process.exit(0);
  }

  // ------------------------------------------------------------------
  // Deepgram event handlers
  // ------------------------------------------------------------------
  streamer.on("connected", () => {
    printBanner("🎙️   Connected to Deepgram — streaming audio");
    if (audioFilePath) {
      console.log(`    Source: ${audioFilePath}`);
    } else {
      console.log("    Source: stdin (pipe raw PCM: 16 kHz, mono, linear16)");
    }
    console.log(`    Interim summary every ${SUMMARY_INTERVAL_MS / 1000}s\n`);

    summaryTimer = setInterval(runInterimSummary, SUMMARY_INTERVAL_MS);

    const audioSource = audioFilePath
      ? createReadStream(audioFilePath)
      : process.stdin;

    audioSource.on("data", (chunk: Buffer) => streamer.send(chunk));
    audioSource.on("end", () => streamer.finish());
    audioSource.on("error", (err: Error) => {
      console.error("\n❌  Audio source error:", err.message);
      shutdown("Audio source error").catch(console.error);
    });
  });

  streamer.on("transcript", (evt: TranscriptEvent) => {
    if (evt.isFinal) {
      buffer.addFinal(evt.text);
      // Show last 100 chars of confirmed transcript on one line.
      const tail = buffer.getFinalTranscript().slice(-100);
      process.stdout.write(`\r✍️   …${tail.padEnd(100)}`);
    } else {
      buffer.updateInterim(evt.text);
      process.stdout.write(`\r💭  ${evt.text.slice(0, 100).padEnd(100)}`);
    }
  });

  streamer.on("utterance_end", () => {
    buffer.clearInterim();
  });

  streamer.on("error", (err: Error) => {
    console.error("\n❌  Deepgram error:", err.message);
  });

  streamer.on("closed", () => {
    shutdown("Deepgram stream closed").catch(console.error);
  });

  // ------------------------------------------------------------------
  // Signal handlers
  // ------------------------------------------------------------------
  process.on("SIGINT", () => {
    shutdown("Interrupted (Ctrl+C)").catch(console.error);
  });
  process.on("SIGTERM", () => {
    shutdown("Received SIGTERM").catch(console.error);
  });

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  streamer.connect();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

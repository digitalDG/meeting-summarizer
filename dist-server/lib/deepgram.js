import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";
/**
 * Wraps Deepgram's live streaming STT WebSocket connection as a typed
 * EventEmitter so the rest of the app can treat it as a simple event source.
 *
 * Emits:
 *   "connected"                 – WebSocket open, ready to receive audio
 *   "transcript" (TranscriptEvent) – interim or final transcript segment
 *   "utterance_end"             – Deepgram detected end of an utterance
 *   "error"    (Error)          – connection or transcription error
 *   "closed"                    – WebSocket closed (stream ended or error)
 */
export class DeepgramStreamer extends EventEmitter {
    opts;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection = null;
    dg;
    constructor(opts) {
        super();
        this.opts = opts;
        this.dg = createClient(opts.apiKey);
    }
    connect() {
        this.connection = this.dg.listen.live({
            model: this.opts.model ?? "nova-2",
            language: this.opts.language ?? "en-US",
            smart_format: true, // punctuation, numbers, etc.
            interim_results: true, // emit low-latency guesses
            utterance_end_ms: 1000, // silence threshold to finalize an utterance
            vad_events: true, // voice-activity detection events
            encoding: "linear16",
            sample_rate: this.opts.sampleRate ?? 16000,
            channels: 1,
        });
        this.connection.on(LiveTranscriptionEvents.Open, () => {
            this.emit("connected");
        });
        this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
            const alt = data.channel?.alternatives?.[0];
            if (!alt?.transcript?.trim())
                return;
            const event = {
                text: alt.transcript,
                isFinal: data.is_final ?? false,
                confidence: alt.confidence,
            };
            this.emit("transcript", event);
        });
        this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
            this.emit("utterance_end");
        });
        this.connection.on(LiveTranscriptionEvents.Error, (err) => {
            this.emit("error", err);
        });
        this.connection.on(LiveTranscriptionEvents.Close, () => {
            this.connection = null;
            this.emit("closed");
        });
    }
    /** Send a raw PCM audio chunk to Deepgram. */
    send(audio) {
        this.connection?.send(audio);
    }
    /** Signal end of audio — Deepgram will flush any remaining transcript. */
    finish() {
        this.connection?.finish();
    }
}

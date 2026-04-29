import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";

export interface DeepgramStreamerOptions {
  apiKey: string;
  /** Deepgram model. Defaults to "nova-2" — best accuracy/speed balance. */
  model?: string;
  language?: string;
  /** Sample rate of the incoming PCM audio in Hz. Defaults to 16000. */
  sampleRate?: number;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  /** Confidence score 0–1, present on final results. */
  confidence?: number;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any = null;
  private readonly dg;

  constructor(private readonly opts: DeepgramStreamerOptions) {
    super();
    this.dg = createClient(opts.apiKey);
  }

  connect(): void {
    this.connection = this.dg.listen.live({
      model: this.opts.model ?? "nova-2",
      language: this.opts.language ?? "en-US",
      smart_format: true,      // punctuation, numbers, etc.
      interim_results: true,   // emit low-latency guesses
      utterance_end_ms: 1000,  // silence threshold to finalize an utterance
      vad_events: true,        // voice-activity detection events
      encoding: "linear16",
      sample_rate: this.opts.sampleRate ?? 16000,
      channels: 1,
    });

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      this.emit("connected");
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data: DeepgramTranscriptData) => {
      const alt = data.channel?.alternatives?.[0];
      if (!alt?.transcript?.trim()) return;

      const event: TranscriptEvent = {
        text: alt.transcript,
        isFinal: data.is_final ?? false,
        confidence: alt.confidence,
      };
      this.emit("transcript", event);
    });

    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      this.emit("utterance_end");
    });

    this.connection.on(LiveTranscriptionEvents.Error, (err: Error) => {
      this.emit("error", err);
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      this.connection = null;
      this.emit("closed");
    });
  }

  /** Send a raw PCM audio chunk to Deepgram. */
  send(audio: Buffer): void {
    this.connection?.send(audio);
  }

  /** Signal end of audio — Deepgram will flush any remaining transcript. */
  finish(): void {
    this.connection?.finish();
  }
}

// Minimal shape of Deepgram's transcript callback payload.
interface DeepgramTranscriptData {
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript: string;
      confidence?: number;
    }>;
  };
}

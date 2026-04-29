import type { MeetingSummary } from "./schemas.js";

/** Messages sent from the server to the browser. */
export type ServerMessage =
  | { type: "connected" }
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "summary"; data: MeetingSummary; label: string; isFinal: boolean; wordCount: number }
  | { type: "status"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

/** Text control messages sent from the browser to the server. Binary frames are raw PCM audio. */
export type ClientMessage =
  | { type: "start"; sampleRate: number }
  | { type: "stop" };

export function parseServerMessage(raw: string): ServerMessage {
  return JSON.parse(raw) as ServerMessage;
}

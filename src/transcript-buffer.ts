export interface TranscriptEntry {
  text: string;
  timestamp: number;
}

/**
 * Accumulates final (confirmed) transcript segments from Deepgram and tracks
 * the latest interim (unconfirmed) result for live display purposes.
 *
 * Deepgram emits two kinds of results:
 *   - interim: fast hypothesis, may change
 *   - final:   locked-in segment (emitted after utterance_end or silence)
 *
 * Only final segments are stored permanently. The summarizer always works
 * from the full set of finals so the summary is stable.
 */
export class TranscriptBuffer {
  private finals: TranscriptEntry[] = [];
  private interimText = "";
  private totalWordCount = 0;

  addFinal(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.finals.push({ text: trimmed, timestamp: Date.now() });
    this.totalWordCount += trimmed.split(/\s+/).length;
    this.interimText = "";
  }

  updateInterim(text: string): void {
    this.interimText = text.trim();
  }

  clearInterim(): void {
    this.interimText = "";
  }

  /** Full transcript including unconfirmed interim text — for display only. */
  getLiveTranscript(): string {
    const base = this.finals.map((e) => e.text).join(" ");
    return this.interimText ? `${base} ${this.interimText}` : base;
  }

  /** Only confirmed segments — safe to send to Claude. */
  getFinalTranscript(): string {
    return this.finals.map((e) => e.text).join(" ");
  }

  getWordCount(): number {
    return this.totalWordCount;
  }

  isEmpty(): boolean {
    return this.finals.length === 0;
  }
}

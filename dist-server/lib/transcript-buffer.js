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
    finals = [];
    interimText = "";
    totalWordCount = 0;
    addFinal(text) {
        const trimmed = text.trim();
        if (!trimmed)
            return;
        this.finals.push({ text: trimmed, timestamp: Date.now() });
        this.totalWordCount += trimmed.split(/\s+/).length;
        this.interimText = "";
    }
    updateInterim(text) {
        this.interimText = text.trim();
    }
    clearInterim() {
        this.interimText = "";
    }
    /** Full transcript including unconfirmed interim text — for display only. */
    getLiveTranscript() {
        const base = this.finals.map((e) => e.text).join(" ");
        return this.interimText ? `${base} ${this.interimText}` : base;
    }
    /** Only confirmed segments — safe to send to Claude. */
    getFinalTranscript() {
        return this.finals.map((e) => e.text).join(" ");
    }
    getWordCount() {
        return this.totalWordCount;
    }
    isEmpty() {
        return this.finals.length === 0;
    }
}

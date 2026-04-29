import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MeetingSummarySchema, type MeetingSummary } from "./schemas.js";

/**
 * System prompt is stable across all requests → ideal for prompt caching.
 * The cache_control marker placed on it tells Claude to cache everything up
 * to and including this block (~1.25× write cost once, ~0.1× read cost after).
 */
const SYSTEM_PROMPT = `You are an expert meeting analyst. Your job is to extract \
structured, actionable information from spoken meeting transcripts.

Guidelines:
- Be concise and factual — only include information explicitly mentioned
- Identify action items with owners when a name appears near a task or commitment
- Distinguish decisions (agreed outcomes) from discussions (topics explored)
- Clean up speech artifacts (um, uh, false starts, repetitions) in your output
- Use empty arrays when a category has no relevant content — never guess or invent
- For incremental updates, merge new content into the existing summary coherently`;

export type SummarizeMode = "incremental" | "final";

export interface SummaryResult {
  summary: MeetingSummary;
  /** Total tokens used (input + output) for cost tracking. */
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

/**
 * Wraps the Claude API to produce Zod-validated structured meeting summaries.
 *
 * Strategy:
 *   - Interim calls use "incremental" mode: Claude is given the previous
 *     summary + only the new transcript text, reducing input tokens over time.
 *   - The final call uses "final" mode: Claude gets the full transcript and
 *     is asked to produce the definitive, comprehensive summary.
 *   - The system prompt is prompt-cached so every call after the first pays
 *     ~90% less on that portion of the input.
 *   - The final call enables adaptive thinking for higher-quality output.
 */
export class MeetingSummarizer {
  private readonly client: Anthropic;
  private lastSummary: MeetingSummary | null = null;
  /** Transcript already incorporated into lastSummary — used to compute delta. */
  private summarizedUpTo = 0;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Summarize the meeting transcript.
   *
   * @param fullTranscript - Complete confirmed transcript so far.
   * @param mode           - "incremental" (fast, cheap) or "final" (thorough).
   */
  async summarize(fullTranscript: string, mode: SummarizeMode): Promise<SummaryResult> {
    const trimmed = fullTranscript.trim();
    if (!trimmed) throw new Error("Cannot summarize an empty transcript");

    const isFinal = mode === "final";

    // For incremental updates, only send Claude the new text since the last summary.
    const newText = trimmed.slice(this.summarizedUpTo).trim();
    const hasExistingSummary = this.lastSummary !== null;

    const userContent = buildUserPrompt({
      newText,
      fullTranscript: trimmed,
      existingSummary: hasExistingSummary ? this.lastSummary! : null,
      isFinal,
    });

    const response = await this.client.messages.parse({
      model: "claude-opus-4-7",
      max_tokens: isFinal ? 8192 : 4096,
      // Adaptive thinking on the final pass for higher-quality synthesis.
      ...(isFinal ? { thinking: { type: "adaptive" as const } } : {}),
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }, // amortize stable system prompt
        },
      ],
      messages: [{ role: "user", content: userContent }],
      output_config: {
        format: zodOutputFormat(MeetingSummarySchema),
      },
    });

    if (!response.parsed_output) {
      throw new Error(
        `Claude returned unparseable output. stop_reason=${response.stop_reason}`
      );
    }

    this.lastSummary = response.parsed_output;
    this.summarizedUpTo = trimmed.length;

    return {
      summary: response.parsed_output,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }

  reset(): void {
    this.lastSummary = null;
    this.summarizedUpTo = 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PromptArgs {
  newText: string;
  fullTranscript: string;
  existingSummary: MeetingSummary | null;
  isFinal: boolean;
}

function buildUserPrompt({ newText, fullTranscript, existingSummary, isFinal }: PromptArgs): string {
  if (isFinal) {
    // Final pass: give Claude everything for the most accurate output.
    return [
      "Produce a comprehensive final structured summary for the following complete meeting transcript.",
      existingSummary
        ? `\nPrevious interim summary (for reference):\n${JSON.stringify(existingSummary, null, 2)}`
        : "",
      `\n\nFull transcript:\n${fullTranscript}`,
    ].join("");
  }

  if (!existingSummary) {
    // First interim summary — no prior context.
    return `Produce an interim structured summary for the following meeting transcript:\n\n${newText}`;
  }

  // Subsequent interim: merge new content into the existing summary.
  return [
    "Update the structured meeting summary below to incorporate the new transcript segment.",
    "Keep all previously identified decisions and action items unless explicitly changed.",
    `\n\nCurrent summary:\n${JSON.stringify(existingSummary, null, 2)}`,
    `\n\nNew transcript segment:\n${newText}`,
  ].join("\n");
}

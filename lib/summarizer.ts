import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MeetingSummarySchema, type MeetingSummary } from "./schemas";

const SYSTEM_PROMPT = `You are an expert meeting analyst. Extract structured, actionable information from spoken meeting transcripts.

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
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export class MeetingSummarizer {
  private readonly client: Anthropic;
  private lastSummary: MeetingSummary | null = null;
  private summarizedUpTo = 0;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  setContext(lastSummary: MeetingSummary | null, summarizedUpTo: number): void {
    this.lastSummary = lastSummary;
    this.summarizedUpTo = summarizedUpTo;
  }

  async summarize(fullTranscript: string, mode: SummarizeMode): Promise<SummaryResult> {
    const trimmed = fullTranscript.trim();
    if (!trimmed) throw new Error("Cannot summarize an empty transcript");

    const isFinal = mode === "final";
    const newText = trimmed.slice(this.summarizedUpTo).trim();

    const userContent = buildUserPrompt({
      newText,
      fullTranscript: trimmed,
      existingSummary: this.lastSummary,
      isFinal,
    });

    const response = await this.client.messages.parse({
      model: isFinal ? "claude-opus-4-7" : "claude-sonnet-4-6",
      max_tokens: isFinal ? 8192 : 4096,
      ...(isFinal ? { thinking: { type: "adaptive" as const } } : {}),
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output_config: { format: zodOutputFormat(MeetingSummarySchema as any) },
    });

    if (!response.parsed_output) {
      throw new Error(`Claude returned unparseable output. stop_reason=${response.stop_reason}`);
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

interface PromptArgs {
  newText: string;
  fullTranscript: string;
  existingSummary: MeetingSummary | null;
  isFinal: boolean;
}

function buildUserPrompt({ newText, fullTranscript, existingSummary, isFinal }: PromptArgs): string {
  if (isFinal) {
    return [
      "Produce a comprehensive final structured summary for the following complete meeting transcript.",
      existingSummary
        ? `\nPrevious interim summary (for reference):\n${JSON.stringify(existingSummary, null, 2)}`
        : "",
      `\n\nFull transcript:\n${fullTranscript}`,
    ].join("");
  }

  if (!existingSummary) {
    return `Produce an interim structured summary for the following meeting transcript:\n\n${newText}`;
  }

  return [
    "Update the structured meeting summary below to incorporate the new transcript segment.",
    "Keep all previously identified decisions and action items unless explicitly changed.",
    `\n\nCurrent summary:\n${JSON.stringify(existingSummary, null, 2)}`,
    `\n\nNew transcript segment:\n${newText}`,
  ].join("\n");
}

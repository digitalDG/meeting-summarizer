import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MeetingSummarySchema } from "./schemas.js";
const SYSTEM_PROMPT = `You are an expert meeting analyst. Extract structured, actionable information from spoken meeting transcripts.

Guidelines:
- Be concise and factual — only include information explicitly mentioned
- Identify action items with owners when a name appears near a task or commitment
- Distinguish decisions (agreed outcomes) from discussions (topics explored)
- Clean up speech artifacts (um, uh, false starts, repetitions) in your output
- Use empty arrays when a category has no relevant content — never guess or invent
- For incremental updates, merge new content into the existing summary coherently`;
export class MeetingSummarizer {
    client;
    lastSummary = null;
    summarizedUpTo = 0;
    constructor(apiKey) {
        this.client = new Anthropic({ apiKey });
    }
    async summarize(fullTranscript, mode) {
        const trimmed = fullTranscript.trim();
        if (!trimmed)
            throw new Error("Cannot summarize an empty transcript");
        const isFinal = mode === "final";
        const newText = trimmed.slice(this.summarizedUpTo).trim();
        const userContent = buildUserPrompt({
            newText,
            fullTranscript: trimmed,
            existingSummary: this.lastSummary,
            isFinal,
        });
        const response = await this.client.messages.parse({
            model: "claude-opus-4-7",
            max_tokens: isFinal ? 8192 : 4096,
            ...(isFinal ? { thinking: { type: "adaptive" } } : {}),
            system: [
                {
                    type: "text",
                    text: SYSTEM_PROMPT,
                    cache_control: { type: "ephemeral" },
                },
            ],
            messages: [{ role: "user", content: userContent }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output_config: { format: zodOutputFormat(MeetingSummarySchema) },
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
    reset() {
        this.lastSummary = null;
        this.summarizedUpTo = 0;
    }
}
function buildUserPrompt({ newText, fullTranscript, existingSummary, isFinal }) {
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

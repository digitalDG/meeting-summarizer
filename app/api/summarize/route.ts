import { MeetingSummarizer, type SummarizeMode } from "@/lib/summarizer";
import type { MeetingSummary } from "@/lib/schemas";
import { NextRequest, NextResponse } from "next/server";

// Claude can take >10s for final summaries with extended thinking
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const body = (await req.json()) as {
    transcript: string;
    mode: SummarizeMode;
    prevSummary?: MeetingSummary | null;
    summarizedUpTo?: number;
  };

  const { transcript, mode, prevSummary, summarizedUpTo } = body;

  if (!transcript?.trim()) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  try {
    const summarizer = new MeetingSummarizer(apiKey);
    if (prevSummary) {
      summarizer.setContext(prevSummary, summarizedUpTo ?? 0);
    }
    const { summary } = await summarizer.summarize(transcript, mode);
    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[summarize]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

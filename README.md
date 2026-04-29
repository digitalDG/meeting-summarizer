# Meeting Summarizer

A real-time AI meeting assistant that transcribes your microphone and produces a structured summary as you speak. Built with Next.js, Deepgram, and Claude. Deployed on Vercel.

![screenshot placeholder](docs/screenshot.png)

## Features

- **Live transcription** via Deepgram's streaming speech-to-text API
- **AI-powered summaries** generated automatically every 30 seconds using Claude (Anthropic)
- Structured output: executive summary, action items with owner/deadline/priority, key decisions, next steps, open questions, topics, and participants
- **Interim + final summary** — a final pass runs when you stop recording for a polished result
- **Editable meeting title** — rename before or after recording
- **Meeting history** — last 50 sessions stored in localStorage with pagination
- **Export to DOCX** — single meeting or all history in one document with page breaks
- **Copy to clipboard** — rich HTML for pasting into Gmail/Outlook, plain text fallback
- **Email via mailto:** — opens your mail client with a pre-filled subject and body
- **Bulk operations** — select multiple history entries to export, email, or delete
- **JSON backup / restore** — download and re-import your full history

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 |
| Language | TypeScript |
| Transcription | Deepgram browser SDK (direct streaming) |
| Summarization | Claude Sonnet (interim) + Claude Opus w/ thinking (final) |
| Schema validation | Zod |
| Document export | docx |
| Hosting | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Deepgram API key](https://console.deepgram.com/) — must be **Member** or **Admin** role (required to issue short-lived browser tokens)

### Setup

```bash
# Clone the repo
git clone https://github.com/digitalDG/meeting-summarizer.git
cd meeting-summarizer

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env and fill in your API keys
```

`.env` variables:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

### Running locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Allow microphone access when prompted, then click **Start Recording**.

### Production build

```bash
npm run build
npm start
```

## Deploying to Vercel

1. Push the repo to GitHub
2. Import the project in [vercel.com](https://vercel.com)
3. Add `ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY` as environment variables
4. Deploy — no additional configuration needed

## Architecture

The browser connects directly to Deepgram for real-time transcription using a short-lived token issued by the server. Summaries are generated server-side via a Next.js API route. No custom server required.

```
Browser mic
  └─ Deepgram browser SDK ──► Deepgram (transcription)
                                    │ transcripts
                                    ▼
                             Browser (transcript buffer + timer)
                                    │ POST /api/summarize
                                    ▼
                             Next.js API route ──► Anthropic Claude
                                    │ summary JSON
                                    ▼
                             Browser UI
```

- `app/api/deepgram-token/route.ts` — issues a 60-second Deepgram token for browser use
- `app/api/summarize/route.ts` — calls Claude with the transcript, returns structured summary
- `lib/summarizer.ts` — Claude prompt and Zod-validated structured output
- `lib/schemas.ts` — shared `MeetingSummary` Zod schema
- `lib/transcript-buffer.ts` — transcript accumulation (runs in the browser)
- `components/MeetingRoom.tsx` — main UI orchestration
- `components/SummaryPanel.tsx` — summary display, copy, email, export
- `components/HistoryPanel.tsx` — history list, pagination, bulk operations
- `lib/meeting-history.ts` — localStorage CRUD helpers
- `lib/export-docx.ts` — DOCX document builder
- `lib/format-summary.ts` — text/HTML/email formatters

## License

Private — all rights reserved.

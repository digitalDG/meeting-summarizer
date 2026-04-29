"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { LiveTranscript } from "./LiveTranscript";
import { SummaryPanel } from "./SummaryPanel";
import { HistoryPanel } from "./HistoryPanel";
import { TranscriptBuffer } from "@/lib/transcript-buffer";
import type { MeetingSummary } from "@/lib/schemas";
import type { SummarizeMode } from "@/lib/summarizer";
import {
  type HistoryEntry,
  loadHistory,
  saveMeeting,
  updateMeetingTitle,
  deleteMeeting,
} from "@/lib/meeting-history";

type ConnectionState = "idle" | "connecting" | "recording" | "summarizing" | "done" | "error";
type MobileTab = "transcript" | "summary";

interface TranscriptLine {
  id: number;
  text: string;
}

const SAMPLE_RATE = 16_000;
const MIN_WORDS = 50;
const SUMMARY_INTERVAL_MS = 30_000;

export function MeetingRoom() {
  const [connState, setConnState] = useState<ConnectionState>("idle");
  const [mobileTab, setMobileTab] = useState<MobileTab>("transcript");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [summaryLabel, setSummaryLabel] = useState("");
  const [summaryIsFinal, setSummaryIsFinal] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [elapsedSecs, setElapsedSecs] = useState(0);

  // History & title
  const [editableTitle, setEditableTitle] = useState("");
  const [currentMeetingId, setCurrentMeetingId] = useState("");
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<HistoryEntry | null>(null);

  // Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Session refs (safe to read inside stale closures)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dgConnRef = useRef<any>(null);
  const transcriptBufferRef = useRef(new TranscriptBuffer());
  const summaryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSummarizingRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const prevSummaryRef = useRef<MeetingSummary | null>(null);
  const summarizedUpToRef = useRef(0);
  const titleEditedRef = useRef(false);
  const savedRef = useRef(false);
  const editableTitleRef = useRef("");
  useEffect(() => { editableTitleRef.current = editableTitle; }, [editableTitle]);

  // Load history on mount (client-side only)
  useEffect(() => {
    setHistoryEntries(loadHistory());
  }, []);

  // Session timer
  useEffect(() => {
    if (connState === "recording" || connState === "summarizing") {
      timerRef.current = setInterval(() => {
        setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [connState]);

  // Auto-switch to summary tab on mobile when final summary arrives
  useEffect(() => {
    if (summaryIsFinal) setMobileTab("summary");
  }, [summaryIsFinal]);

  // Auto-save to history when session completes with a final summary
  useEffect(() => {
    if (connState === "done" && summaryIsFinal && summary && !savedRef.current) {
      savedRef.current = true;
      const title = editableTitle.trim() || summary.title;
      const entry: HistoryEntry = {
        id: currentMeetingId,
        title,
        timestamp: Date.now(),
        wordCount,
        label: summaryLabel,
        summary,
      };
      saveMeeting(entry);
      setHistoryEntries(loadHistory());
      setEditableTitle(title);
    }
  }, [connState, summaryIsFinal, summary, editableTitle, currentMeetingId, wordCount, summaryLabel]);

  const cleanup = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const runSummary = useCallback(async (mode: SummarizeMode) => {
    if (isSummarizingRef.current) return;

    const transcript = transcriptBufferRef.current.getFinalTranscript();
    const wc = transcriptBufferRef.current.getWordCount();

    if (mode === "incremental" && wc < MIN_WORDS) return;
    if (!transcript.trim()) return;

    isSummarizingRef.current = true;
    setIsSummarizing(true);
    setStatusMsg(mode === "final" ? "Generating final summary…" : `Summarizing ${wc} words…`);

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          mode,
          prevSummary: prevSummaryRef.current,
          summarizedUpTo: summarizedUpToRef.current,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Summarize failed");

      prevSummaryRef.current = data.summary;
      summarizedUpToRef.current = transcript.length;

      setSummary(data.summary);
      setSummaryLabel(mode === "final" ? "Final" : "Interim");
      setSummaryIsFinal(mode === "final");
      setStatusMsg("");

      if (!titleEditedRef.current) {
        setEditableTitle(data.summary.title);
      }
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSummarizingRef.current = false;
      setIsSummarizing(false);
    }
  }, []);

  const endSession = useCallback(async () => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;

    if (summaryIntervalRef.current) {
      clearInterval(summaryIntervalRef.current);
      summaryIntervalRef.current = null;
    }
    cleanup();
    dgConnRef.current?.requestClose();
    dgConnRef.current = null;

    if (transcriptBufferRef.current.isEmpty()) {
      setConnState("done");
      setStatusMsg("");
      setIsSummarizing(false);
      return;
    }

    setConnState("summarizing");
    await runSummary("final");
    setConnState("done");
  }, [cleanup, runSummary]);

  const startRecording = useCallback(async () => {
    setConnState("connecting");
    setLines([]);
    setInterim("");
    setWordCount(0);
    setSummary(null);
    setSummaryLabel("");
    setSummaryIsFinal(false);
    setIsSummarizing(false);
    setElapsedSecs(0);
    setMobileTab("transcript");
    setViewingEntry(null);
    setCurrentMeetingId(crypto.randomUUID());
    savedRef.current = false;
    sessionEndedRef.current = false;
    isSummarizingRef.current = false;
    transcriptBufferRef.current = new TranscriptBuffer();
    prevSummaryRef.current = null;
    summarizedUpToRef.current = 0;

    const preName = editableTitleRef.current.trim();
    setEditableTitle(preName);
    titleEditedRef.current = preName.length > 0;
    startTimeRef.current = Date.now();

    try {
      setStatusMsg("Requesting microphone…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      setStatusMsg("Setting up audio…");
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio-processor.js");

      setStatusMsg("Connecting to Deepgram…");
      const tokenRes = await fetch("/api/deepgram-token");
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error || "Failed to get Deepgram token");

      const dg = createClient(tokenData.key);
      const connection = dg.listen.live({
        model: "nova-2",
        language: "en-US",
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
        encoding: "linear16",
        sample_rate: SAMPLE_RATE,
        channels: 1,
      });
      dgConnRef.current = connection;

      connection.on(LiveTranscriptionEvents.Open, () => {
        setConnState("recording");
        setStatusMsg("");
        summaryIntervalRef.current = setInterval(
          () => runSummary("incremental"),
          SUMMARY_INTERVAL_MS
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const alt = data?.channel?.alternatives?.[0];
        if (!alt?.transcript?.trim()) return;

        const text: string = alt.transcript;
        const isFinal: boolean = data.is_final ?? false;

        if (isFinal) {
          transcriptBufferRef.current.addFinal(text);
          setLines((prev) => [...prev, { id: prev.length, text }]);
          setInterim("");
          setWordCount(transcriptBufferRef.current.getWordCount());
        } else {
          transcriptBufferRef.current.updateInterim(text);
          setInterim(text);
        }
      });

      connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        transcriptBufferRef.current.clearInterim();
        setInterim("");
      });

      connection.on(LiveTranscriptionEvents.Error, (err: Error) => {
        console.error("[MeetingRoom] Deepgram error", err);
        setStatusMsg(`Error: ${err.message}`);
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        endSession().catch(console.error);
      });

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "audio-processor");
      workletNodeRef.current = worklet;

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        dgConnRef.current?.send(e.data);
      };

      source.connect(worklet);
      worklet.connect(ctx.destination);
    } catch (err) {
      console.error("[MeetingRoom] startRecording error:", err);
      setConnState("error");
      setStatusMsg(err instanceof Error ? err.message : "Failed to start recording");
      cleanup();
    }
  }, [endSession, runSummary, cleanup]);

  const stopRecording = useCallback(() => {
    endSession().catch(console.error);
  }, [endSession]);

  function handleNewMeeting() {
    editableTitleRef.current = "";
    titleEditedRef.current = false;
    setEditableTitle("");
    startRecording();
  }

  function handleTitleChange(newTitle: string) {
    if (viewingEntry) {
      updateMeetingTitle(viewingEntry.id, newTitle);
      setViewingEntry({ ...viewingEntry, title: newTitle });
      setHistoryEntries(loadHistory());
    } else {
      titleEditedRef.current = true;
      setEditableTitle(newTitle);
      if (savedRef.current && currentMeetingId) {
        updateMeetingTitle(currentMeetingId, newTitle);
        setHistoryEntries(loadHistory());
      }
    }
  }

  function handleViewEntry(entry: HistoryEntry) {
    setViewingEntry(entry);
    setShowHistory(false);
    setMobileTab("summary");
  }

  function handleDeleteEntry(id: string) {
    deleteMeeting(id);
    setHistoryEntries(loadHistory());
    if (viewingEntry?.id === id) setViewingEntry(null);
  }

  // Resolved display values — history view overrides live session
  const activeSummary = viewingEntry?.summary ?? summary;
  const activeLabel = viewingEntry?.label ?? summaryLabel;
  const activeIsFinal = viewingEntry ? true : summaryIsFinal;
  const activeIsLoading = viewingEntry ? false : isSummarizing;
  const activeWordCount = viewingEntry?.wordCount ?? wordCount;
  const activeTitle = viewingEntry?.title ?? editableTitle;

  const isRecording = connState === "recording";
  const isBusy = connState === "connecting" || connState === "summarizing";
  const canStart = connState === "idle" || connState === "done" || connState === "error";

  const formattedTime = [
    Math.floor(elapsedSecs / 3600),
    Math.floor((elapsedSecs % 3600) / 60),
    elapsedSecs % 60,
  ]
    .map((n, i) => (i === 0 && n === 0 ? null : String(n).padStart(2, "0")))
    .filter(Boolean)
    .join(":");

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-4">
          <span className="text-lg md:text-xl shrink-0">🎙️</span>
          <input
            type="text"
            value={activeTitle}
            onChange={(e) => {
              if (viewingEntry) {
                setViewingEntry({ ...viewingEntry, title: e.target.value });
              } else {
                titleEditedRef.current = true;
                setEditableTitle(e.target.value);
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onBlur={(e) => {
              const t = e.currentTarget.value.trim();
              if (viewingEntry) {
                if (t) {
                  updateMeetingTitle(viewingEntry.id, t);
                  setViewingEntry({ ...viewingEntry, title: t });
                  setHistoryEntries(loadHistory());
                }
              } else if (savedRef.current && currentMeetingId) {
                if (t) { updateMeetingTitle(currentMeetingId, t); setHistoryEntries(loadHistory()); }
              }
            }}
            placeholder="Untitled meeting"
            className="flex-1 min-w-0 bg-transparent text-slate-200 placeholder:text-slate-600 text-sm font-medium outline-none border-b border-transparent hover:border-slate-700 focus:border-indigo-500 transition-colors py-0.5"
          />
        </div>

        <div className="flex items-center gap-3 md:gap-4 shrink-0">
          {(isRecording || isBusy) && elapsedSecs > 0 && (
            <span className="hidden sm:block text-slate-400 text-sm font-mono">{formattedTime}</span>
          )}

          {statusMsg && !isRecording && (
            <span className="hidden sm:block text-slate-500 text-xs max-w-36 md:max-w-48 truncate">
              {statusMsg}
            </span>
          )}

          {/* History button */}
          <button
            onClick={() => setShowHistory(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-sm"
            title="Meeting history"
          >
            <HistoryIcon />
            <span className="hidden sm:block">History</span>
            {historyEntries.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-medium flex items-center justify-center">
                {historyEntries.length > 99 ? "99+" : historyEntries.length}
              </span>
            )}
          </button>

          <RecordButton
            isRecording={isRecording}
            isBusy={isBusy}
            canStart={canStart}
            onStart={startRecording}
            onStop={stopRecording}
          />
        </div>
      </header>

      {/* Mobile status bar */}
      {statusMsg && (connState === "connecting" || connState === "summarizing") && (
        <div className="sm:hidden shrink-0 px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs text-slate-400 flex items-center gap-2">
          <Pulse />
          {statusMsg}
        </div>
      )}

      {/* Banner area */}
      {(() => {
        const banner = viewingEntry ? "viewing"
          : connState === "done" ? "done"
          : connState === "error" ? "error"
          : null;
        return (
          <div
            className="shrink-0 grid transition-[grid-template-rows] duration-200"
            style={{ gridTemplateRows: banner ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <div className="px-4 md:px-6 pt-3 pb-0">
                {banner === "viewing" && viewingEntry && (
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-indigo-950 border border-indigo-800 text-indigo-300 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <HistoryIcon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Viewing: {viewingEntry.title}</span>
                    </span>
                    <button
                      onClick={() => setViewingEntry(null)}
                      className="shrink-0 ml-3 text-xs font-medium text-indigo-400 hover:text-indigo-200 underline underline-offset-2 transition-colors"
                    >
                      Back to current
                    </button>
                  </div>
                )}
                {banner === "done" && (
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-300 text-sm">
                    <span className="flex items-center gap-2">
                      <span>✓</span>
                      Meeting complete — saved to history.
                    </span>
                    <button
                      onClick={handleNewMeeting}
                      className="text-xs font-medium text-emerald-400 hover:text-emerald-200 underline underline-offset-2 transition-colors"
                    >
                      New meeting
                    </button>
                  </div>
                )}
                {banner === "error" && (
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-red-950 border border-red-800 text-red-300 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0">⚠</span>
                      <span className="truncate">{statusMsg || "Connection error"}</span>
                    </span>
                    <button
                      onClick={startRecording}
                      className="shrink-0 ml-3 text-xs font-medium text-red-400 hover:text-red-200 underline underline-offset-2 transition-colors"
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Mobile tab bar */}
      <div className="md:hidden shrink-0 flex border-b border-slate-800 mt-3 mx-4">
        {(["transcript", "summary"] as MobileTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              mobileTab === tab
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
            {tab === "summary" && activeSummary && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeIsFinal
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "bg-slate-700 text-slate-400"
                }`}
              >
                {activeIsFinal ? "final" : "live"}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <main className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-2">
        {/* Transcript pane */}
        <div
          className={`p-4 md:p-5 md:border-r md:border-slate-800 md:flex md:flex-col md:min-h-0 ${
            mobileTab === "transcript" ? "flex flex-col flex-1 min-h-0" : "hidden"
          }`}
        >
          <LiveTranscript
            lines={lines}
            interim={interim}
            wordCount={wordCount}
            minWords={MIN_WORDS}
            isRecording={isRecording}
          />
        </div>

        {/* Summary pane */}
        <div
          className={`p-4 md:p-5 md:flex md:flex-col md:min-h-0 ${
            mobileTab === "summary" ? "flex flex-col flex-1 min-h-0" : "hidden"
          }`}
        >
          <SummaryPanel
            summary={activeSummary}
            label={activeLabel}
            isFinal={activeIsFinal}
            isLoading={activeIsLoading}
            wordCount={activeWordCount}
            minWords={MIN_WORDS}
            editableTitle={activeTitle}
            onTitleChange={handleTitleChange}
          />
        </div>
      </main>

      {/* History slide-in panel */}
      {showHistory && (
        <HistoryPanel
          entries={historyEntries}
          onView={handleViewEntry}
          onDelete={handleDeleteEntry}
          onRefresh={() => setHistoryEntries(loadHistory())}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
interface RecordButtonProps {
  isRecording: boolean;
  isBusy: boolean;
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
}

function RecordButton({ isRecording, isBusy, canStart, onStart, onStop }: RecordButtonProps) {
  if (isRecording) {
    return (
      <button
        onClick={onStop}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 transition-colors font-medium text-sm"
      >
        <span className="w-2 h-2 rounded-sm bg-white" />
        Stop
      </button>
    );
  }

  if (isBusy) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-700 text-slate-400 text-sm cursor-not-allowed"
      >
        <Pulse />
        Processing…
      </button>
    );
  }

  return (
    <button
      onClick={onStart}
      disabled={!canStart}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 transition-colors font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="w-2 h-2 rounded-full bg-white" />
      Record
    </button>
  );
}

function Pulse() {
  return (
    <span className="relative flex w-2 h-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75" />
      <span className="relative inline-flex rounded-full w-2 h-2 bg-slate-500" />
    </span>
  );
}

function HistoryIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

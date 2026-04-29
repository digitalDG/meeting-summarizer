"use client";

import { useState, useEffect, useRef } from "react";
import type { MeetingSummary } from "@/lib/schemas";
import { exportToDocx } from "@/lib/export-docx";
import { formatSummaryAsText, formatSummaryAsHtml, formatSummaryAsEmailText } from "@/lib/format-summary";

interface Props {
  summary: MeetingSummary | null;
  label: string;
  isFinal: boolean;
  isLoading: boolean;
  wordCount: number;
  minWords: number;
  editableTitle: string;
  onTitleChange: (title: string) => void;
}

export function SummaryPanel({
  summary,
  label,
  isFinal,
  isLoading,
  wordCount,
  minWords,
  editableTitle,
  onTitleChange,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(editableTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Keep local title in sync when the prop changes (new summary arrived or history entry viewed)
  useEffect(() => {
    if (!editingTitle) setLocalTitle(editableTitle);
  }, [editableTitle, editingTitle]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  function commitTitle() {
    setEditingTitle(false);
    const trimmed = localTitle.trim();
    if (trimmed && trimmed !== editableTitle) {
      onTitleChange(trimmed);
    } else {
      setLocalTitle(editableTitle); // revert if empty or unchanged
    }
  }

  async function copyToClipboard() {
    if (!summary) return;
    const s = editableTitle.trim() ? { ...summary, title: editableTitle } : summary;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([formatSummaryAsHtml(s)], { type: "text/html" }),
          "text/plain": new Blob([formatSummaryAsText(s)], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(formatSummaryAsText(s));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleEmail() {
    if (!summary) return;
    const s = editableTitle.trim() ? { ...summary, title: editableTitle } : summary;
    const subject = encodeURIComponent(s.title);
    const body = encodeURIComponent(formatSummaryAsEmailText(s));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function handleExport() {
    if (!summary || exporting) return;
    setExporting(true);
    try {
      const s = editableTitle.trim() ? { ...summary, title: editableTitle } : summary;
      await exportToDocx(s, label);
    } finally {
      setExporting(false);
    }
  }

  if (isLoading && !summary) {
    return (
      <div className="flex flex-col h-full">
        <div className="mb-3"><SummaryHeader label={label} isFinal={isFinal} /></div>
        <div className="flex-1 flex items-center justify-center rounded-xl bg-slate-900/50 border border-slate-800 min-h-0">
          <div className="flex items-center gap-3 text-slate-400 text-sm">
            <Spinner />
            Generating summary…
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    const progressPct = Math.min(100, Math.round((wordCount / minWords) * 100));
    return (
      <div className="flex flex-col h-full">
        <div className="mb-3"><SummaryHeader label={label} isFinal={false} /></div>
        <div className="flex-1 flex flex-col items-center justify-center rounded-xl bg-slate-900/50 border border-slate-800 p-4 gap-4 min-h-0">
          <p className="text-slate-600 text-sm text-center leading-relaxed">
            A structured summary will appear here after enough speech is captured
            (min. {minWords} words).
          </p>
          {wordCount > 0 && (
            <div className="w-full max-w-xs">
              <div className="flex justify-between mb-1.5 text-xs text-slate-600">
                <span>Words captured</span>
                <span>{wordCount} / {minWords}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header row */}
      <div className="flex items-center justify-between mb-3">
        <SummaryHeader label={label} isFinal={isFinal} />
        <div className="flex items-center gap-2">
          {isLoading && (
            <div className="flex items-center gap-1.5 text-slate-500 text-xs">
              <Spinner size="sm" /> updating…
            </div>
          )}
          <button
            onClick={handleEmail}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800"
          >
            <EmailIcon />
            Email
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <DownloadIcon />
            {exporting ? "Saving…" : "Export"}
          </button>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800"
          >
            {copied ? (
              <>
                <CheckIcon />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <CopyIcon />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 pr-1">
        {/* Title card — click to rename */}
        <Card>
          <div className="mb-2">
            {editingTitle ? (
              <input
                ref={titleInputRef}
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") {
                    setEditingTitle(false);
                    setLocalTitle(editableTitle);
                  }
                }}
                className="w-full bg-transparent border-b border-indigo-500 outline-none text-white font-semibold text-base leading-snug pb-0.5"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="text-left w-full group flex items-start gap-2"
                title="Click to rename"
              >
                <span className="font-semibold text-white text-base leading-snug">
                  {editableTitle || summary.title}
                </span>
                <span className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-slate-400">
                  <PencilIcon />
                </span>
              </button>
            )}
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            {summary.executive_summary}
          </p>
        </Card>

        {summary.action_items.length > 0 && (
          <Card label="📌 Action Items">
            <ul className="space-y-2">
              {summary.action_items.map((a, i) => (
                <li key={i} className="text-sm">
                  <span className="text-slate-200">{a.task}</span>
                  {a.owner && (
                    <span className="ml-2 text-xs bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded">
                      {a.owner}
                    </span>
                  )}
                  {a.deadline && (
                    <span className="ml-1.5 text-xs text-slate-500">· {a.deadline}</span>
                  )}
                  {a.priority && a.priority !== "medium" && (
                    <span
                      className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${
                        a.priority === "high"
                          ? "bg-red-900/50 text-red-300"
                          : "bg-slate-700 text-slate-400"
                      }`}
                    >
                      {a.priority}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {summary.key_decisions.length > 0 && (
          <Card label="✅ Decisions">
            <BulletList items={summary.key_decisions} />
          </Card>
        )}

        {summary.topics_discussed.length > 0 && (
          <Card label="🗂 Topics Discussed">
            <div className="flex flex-wrap gap-1.5">
              {summary.topics_discussed.map((t, i) => (
                <span key={i} className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          </Card>
        )}

        {summary.open_questions.length > 0 && (
          <Card label="❓ Open Questions">
            <BulletList items={summary.open_questions} color="text-amber-300" />
          </Card>
        )}

        {summary.next_steps.length > 0 && (
          <Card label="🔜 Next Steps">
            <BulletList items={summary.next_steps} />
          </Card>
        )}

        {summary.participants_mentioned.length > 0 && (
          <Card label="👥 Participants">
            <p className="text-slate-300 text-sm">{summary.participants_mentioned.join(", ")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryHeader({ label, isFinal }: { label: string; isFinal: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Summary</h2>
      {label && (
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            isFinal ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-700 text-slate-400"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

function Card({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-4">
      {label && (
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

function BulletList({ items, color = "text-slate-300" }: { items: string[]; color?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className={`text-sm flex gap-2 ${color}`}>
          <span className="text-slate-600 shrink-0 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  return (
    <svg className={`${cls} animate-spin text-slate-400`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.768-6.768a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="2,4 12,13 22,4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

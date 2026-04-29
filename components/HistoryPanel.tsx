"use client";

import { useState, useEffect, useRef } from "react";
import type { HistoryEntry } from "@/lib/meeting-history";
import { importHistoryFromJson } from "@/lib/meeting-history";
import { exportToDocx, exportAllToDocx } from "@/lib/export-docx";
import { formatSummaryAsEmailText } from "@/lib/format-summary";

interface Props {
  entries: HistoryEntry[];
  onView: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

const PAGE_SIZE = 6;
const EMAIL_MAX = 5;

export function HistoryPanel({ entries, onView, onDelete, onRefresh, onClose }: Props) {
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allSelected = entries.length > 0 && selectedIds.size === entries.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < entries.length;
  const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
  const hasSelection = selectedIds.size > 0;

  // Keep indeterminate state on select-all checkbox
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // Drop selections for deleted entries
  useEffect(() => {
    const valid = new Set(entries.map((e) => e.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [entries]);

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(entries.map((e) => e.id)));
    setConfirmBulkDelete(false);
  }

  async function handleExportSelected() {
    if (exportingAll) return;
    setExportingAll(true);
    try { await exportAllToDocx(selectedEntries); } finally { setExportingAll(false); }
  }

  function handleEmailAll() {
    const combined = entries
      .map((e, i) => `Meeting ${i + 1} of ${entries.length}\n\n${formatSummaryAsEmailText({ ...e.summary, title: e.title })}`)
      .join("\n\n" + "─".repeat(40) + "\n\n");
    const subject = entries.length === 1 ? entries[0].title : `Meeting Summaries (${entries.length})`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(combined)}`;
  }

  function handleEmailSelected() {
    const total = selectedEntries.length;
    const combined = selectedEntries
      .map((e, i) => `Meeting ${i + 1} of ${total}\n\n${formatSummaryAsEmailText({ ...e.summary, title: e.title })}`)
      .join("\n\n" + "─".repeat(40) + "\n\n");
    const subject = selectedEntries.length === 1
      ? selectedEntries[0].title
      : `Meeting Summaries (${selectedEntries.length})`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(combined)}`;
  }

  function handleBackup() {
    const data = hasSelection ? selectedEntries : entries;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportAll() {
    if (exportingAll || entries.length === 0) return;
    setExportingAll(true);
    try { await exportAllToDocx(entries); } finally { setExportingAll(false); }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { imported, skipped } = importHistoryFromJson(reader.result as string);
        onRefresh();
        setImportMsg(
          imported > 0
            ? `${imported} meeting${imported !== 1 ? "s" : ""} imported${skipped > 0 ? `, ${skipped} skipped` : ""}.`
            : "No new meetings found."
        );
      } catch {
        setImportMsg("Import failed — invalid file.");
      }
      setTimeout(() => setImportMsg(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleEmail(entry: HistoryEntry) {
    const subject = encodeURIComponent(entry.title);
    const body = encodeURIComponent(formatSummaryAsEmailText({ ...entry.summary, title: entry.title }));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function handleExport(entry: HistoryEntry) {
    setExportingId(entry.id);
    try {
      await exportToDocx({ ...entry.summary, title: entry.title }, entry.label);
    } finally {
      setExportingId(null);
    }
  }

  function handleBulkDelete() {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }
    selectedIds.forEach((id) => onDelete(id));
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  }

  function handleDelete(id: string) {
    if (confirmDeleteId === id) {
      onDelete(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  }

  const emailCount = hasSelection ? selectedEntries.length : entries.length;
  const emailTooMany = emailCount > EMAIL_MAX;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />

      <div className="w-80 md:w-96 bg-slate-900 border-l border-slate-700 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-100 text-sm">Meeting History</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {entries.length} meeting{entries.length !== 1 ? "s" : ""}
                {hasSelection && ` · ${selectedIds.size} selected`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800"
            >
              <XIcon />
            </button>
          </div>

          {/* Select all row */}
          <div className="flex items-center px-5 pb-1">
            <label className="flex items-center gap-1.5 cursor-pointer group">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={entries.length === 0}
                className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer disabled:opacity-30"
              />
              <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">
                {allSelected ? "Deselect all" : "Select all"}
              </span>
            </label>
          </div>

          {/* Action row — always visible */}
          <div className="flex items-center gap-1 px-4 pb-3">
            <button
              onClick={hasSelection ? handleExportSelected : handleExportAll}
              disabled={exportingAll || entries.length === 0}
              className="text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exportingAll ? "Exporting…" : hasSelection ? "Export" : "Export all"}
            </button>
            <span className="text-slate-500 text-xs">·</span>
            <button
              onClick={hasSelection ? handleEmailSelected : handleEmailAll}
              disabled={emailTooMany || entries.length === 0}
              title={emailTooMany ? `Max ${EMAIL_MAX} meetings per email` : undefined}
              className="text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Email
            </button>
            {hasSelection && (
              <>
                <span className="text-slate-500 text-xs">·</span>
                <button
                  onClick={() => { setConfirmBulkDelete(false); setSelectedIds(new Set()); }}
                  className="text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-800"
                >
                  Clear
                </button>
                <span className="text-slate-500 text-xs">·</span>
                <button
                  onClick={handleBulkDelete}
                  className={`text-xs transition-colors px-2 py-1 rounded hover:bg-slate-800 ${
                    confirmBulkDelete ? "text-red-400 font-medium" : "text-slate-500 hover:text-red-400"
                  }`}
                >
                  {confirmBulkDelete ? "Confirm delete" : "Delete"}
                </button>
                {confirmBulkDelete && (
                  <button
                    onClick={() => setConfirmBulkDelete(false)}
                    className="text-xs text-slate-600 hover:text-slate-400 transition-colors px-2 py-1 rounded hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
            <span className="text-slate-500 text-xs">·</span>
            <button
              onClick={handleBackup}
              disabled={entries.length === 0}
              className="text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Backup
            </button>
            <span className="text-slate-500 text-xs">·</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-slate-500 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-800"
            >
              Restore
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          </div>
          {importMsg && <p className="px-5 pb-2 text-xs text-emerald-400">{importMsg}</p>}
          {hasSelection && emailTooMany && <p className="px-5 pb-2 text-xs text-amber-400">Select max {EMAIL_MAX} meetings to email.</p>}
          <div className="border-b border-slate-800" />
        </div>

        {entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-slate-600 text-sm text-center leading-relaxed">
              No past meetings yet. Completed meetings will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {pageEntries.map((entry) => (
              <div
                key={entry.id}
                className={`px-4 py-4 border-b border-slate-800 transition-colors ${
                  selectedIds.has(entry.id) ? "bg-slate-800/60" : "hover:bg-slate-800/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggleSelect(entry.id)}
                    className="mt-0.5 w-3.5 h-3.5 shrink-0 accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <button className="w-full text-left" onClick={() => onView(entry)}>
                      <p className="text-slate-200 text-sm font-medium leading-snug line-clamp-2 mb-1">
                        {entry.title}
                      </p>
                      <p className="text-slate-500 text-xs">
                        {formatDate(entry.timestamp)}
                        <span className="mx-1.5 text-slate-700">·</span>
                        {entry.wordCount.toLocaleString()} words
                        <span className="mx-1.5 text-slate-700">·</span>
                        <span className={entry.label === "Final" ? "text-emerald-500" : "text-slate-500"}>
                          {entry.label}
                        </span>
                      </p>
                    </button>

                    <div className="flex items-center gap-3 mt-2.5">
                      <button
                        onClick={() => onView(entry)}
                        className="text-xs text-indigo-400 hover:text-indigo-200 transition-colors"
                      >
                        View
                      </button>
                      <span className="text-slate-500 text-xs">·</span>
                      <button
                        onClick={() => handleEmail(entry)}
                        className="text-xs text-slate-500 hover:text-slate-200 transition-colors"
                      >
                        Email
                      </button>
                      <span className="text-slate-500 text-xs">·</span>
                      <button
                        onClick={() => handleExport(entry)}
                        disabled={exportingId === entry.id}
                        className="text-xs text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-40"
                      >
                        {exportingId === entry.id ? "Saving…" : "Export"}
                      </button>
                      <span className="text-slate-500 text-xs">·</span>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className={`text-xs transition-colors ${
                          confirmDeleteId === entry.id
                            ? "text-red-400 font-medium"
                            : "text-slate-500 hover:text-red-400"
                        }`}
                      >
                        {confirmDeleteId === entry.id ? "Confirm delete" : "Delete"}
                      </button>
                      {confirmDeleteId === entry.id && (
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-800">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-slate-800"
            >
              ← Prev
            </button>
            <span className="text-xs text-slate-500">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages - 1}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-slate-800"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isThisYear) return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

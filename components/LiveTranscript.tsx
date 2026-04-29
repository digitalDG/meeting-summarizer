"use client";

import { useEffect, useRef } from "react";

interface TranscriptLine {
  id: number;
  text: string;
}

interface Props {
  lines: TranscriptLine[];
  interim: string;
  wordCount: number;
  minWords: number;
  isRecording: boolean;
}

export function LiveTranscript({ lines, interim, wordCount, minWords, isRecording }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, interim]);

  const empty = lines.length === 0 && !interim;
  const showProgress = isRecording && wordCount < minWords;
  const progressPct = Math.min(100, Math.round((wordCount / minWords) * 100));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Live Transcript
        </h2>
        {wordCount > 0 && !showProgress && (
          <span className="text-xs text-slate-500">{wordCount.toLocaleString()} words</span>
        )}
      </div>

      {/* Bordered box — flex-col so progress bar + content share the space cleanly */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl bg-slate-900/50 border border-slate-800 p-4 min-h-0 flex flex-col"
      >
        {showProgress && (
          <div className="shrink-0 mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-600">
                {wordCount}/{minWords} words until first summary
              </span>
            </div>
            <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {empty ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-600 text-sm text-center leading-relaxed">
              {isRecording
                ? "Listening… start speaking and your transcript will appear here."
                : "Transcript will appear here once recording starts…"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <p
                key={line.id}
                className="text-slate-200 text-sm leading-relaxed animate-fade-in-up"
              >
                {line.text}
              </p>
            ))}
            {interim && (
              <p className="text-slate-500 text-sm leading-relaxed italic">{interim}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

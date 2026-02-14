"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CriticSummary } from "@/lib/store";

export function CriticSummaryCard({ summary }: { summary: CriticSummary }) {
  const [openSection, setOpenSection] = useState<"feedback" | "praise" | "logs" | null>("feedback");
  const score = summary.score;
  const scoreTone =
    score == null ? "border-zinc-700 text-zinc-300" : score >= 8 ? "border-violet-500/50 text-violet-300" : "border-zinc-700 text-zinc-300";
  const verdictTone = summary.accepted ? "text-violet-300" : "text-zinc-300";
  const toggleBtn = "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors";
  const toggleIdle = "border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700";
  const toggleActive = "border-violet-500/40 text-violet-300 bg-violet-500/10";

  const content =
    openSection === "feedback"
      ? summary.feedback
      : openSection === "praise"
      ? summary.praise
      : openSection === "logs"
      ? summary.codeExecutionLogs
      : "";

  return (
    <div className="w-full max-w-2xl rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-zinc-400">Critic review</div>
        <div className={`rounded-full border px-2 py-0.5 text-xs font-medium ${scoreTone}`}>
          {score == null ? "Score N/A" : `Score ${score}/10`}
        </div>
      </div>
      <div className={`text-xs ${verdictTone}`}>
        {summary.accepted ? "Approved" : "Needs revision"}
      </div>

      <div className="flex flex-wrap gap-2">
        {summary.feedback.trim() && (
          <button
            type="button"
            className={`${toggleBtn} ${openSection === "feedback" ? toggleActive : toggleIdle}`}
            onClick={() => setOpenSection((v) => (v === "feedback" ? null : "feedback"))}
          >
            {openSection === "feedback" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Feedback
          </button>
        )}
        {summary.praise.trim() && (
          <button
            type="button"
            className={`${toggleBtn} ${openSection === "praise" ? toggleActive : toggleIdle}`}
            onClick={() => setOpenSection((v) => (v === "praise" ? null : "praise"))}
          >
            {openSection === "praise" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Keep
          </button>
        )}
        {summary.codeExecutionLogs.trim() && (
          <button
            type="button"
            className={`${toggleBtn} ${openSection === "logs" ? toggleActive : toggleIdle}`}
            onClick={() => setOpenSection((v) => (v === "logs" ? null : "logs"))}
          >
            {openSection === "logs" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Logs
          </button>
        )}
      </div>

      {openSection && content.trim() && (
        <div className="rounded-md border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

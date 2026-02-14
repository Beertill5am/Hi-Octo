"use client";

import { usePipelineStore } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { cancelPipeline, resumePipeline } from "@/lib/api";
import { ChevronUp, ChevronDown, X, RotateCcw, Loader2 } from "lucide-react";

/* ── Professional node labels ────────────────────────────────────── */
const NODE_STATUS: Record<string, { label: string; emoji: string }> = {
  guardrail:       { label: "Running safety checks",      emoji: "🛡️" },
  dispatcher:      { label: "Routing your request",       emoji: "🔀" },
  expander:        { label: "Expanding search queries",    emoji: "🔎" },
  query_plan_hitl: { label: "Awaiting your review",       emoji: "✋" },
  search_worker:   { label: "Searching knowledge base",   emoji: "📚" },
  deduplicator:    { label: "Removing duplicates",         emoji: "🧹" },
  grader:          { label: "Evaluating relevance",        emoji: "⚖️" },
  web_search:      { label: "Searching the web",           emoji: "🌐" },
  hitl_approval:   { label: "Waiting for your approval",   emoji: "✋" },
  generate:        { label: "Writing your answer",         emoji: "✍️" },
  code_tester:     { label: "Testing code snippets",       emoji: "🧪" },
  critic:          { label: "Reviewing quality",           emoji: "🔍" },
};

const NODE_SHORT: Record<string, string> = {
  guardrail: "Safety",
  input_guardrail: "Input Guard",
  dispatcher: "Route",
  expander: "Expand",
  expand_query: "Expand Query",
  query_plan_hitl: "Plan Review",
  query_fanout: "Query Fanout",
  search_worker: "Search",
  deduplicator: "Deduplicate",
  deduplicate: "Deduplicate",
  grader: "Grade",
  grade_documents: "Grade Docs",
  web_search: "Web Search",
  web_search_intent_hitl: "Web Approval",
  hitl_approval: "Approve",
  retrieval_hitl: "Citation Review",
  draft_review_hitl: "Draft Review",
  generate: "Write",
  code_tester: "Test Code",
  critic: "Review",
};

function prettifyNodeName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function AgentStatus() {
  const {
    status,
    currentNode,
    nodes,
    jobStartedAt,
    lastLatencyMs,
    jobId,
  } = usePipelineStore();

  const [elapsedMs, setElapsedMs] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [actionBusy, setActionBusy] = useState<"cancel" | "resume" | null>(null);

  useEffect(() => {
    const shouldTick = status === "running" || status === "hitl_waiting";
    if (!jobStartedAt || !shouldTick) return;
    const tick = () => setElapsedMs(Date.now() - jobStartedAt);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [jobStartedAt, status]);

  const activeStep = useMemo(() => {
    if (!currentNode) return null;
    return NODE_STATUS[currentNode] || { label: currentNode, emoji: "⚙️" };
  }, [currentNode]);

  /* Hide when idle */
  if (status === "idle") return null;

  const totalMs = status === "completed" ? lastLatencyMs : elapsedMs;
  const elapsed = totalMs && totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : "";

  const doneNodes = nodes.filter((n) => n.status === "done");
  const totalNodes = nodes.length;

  const statusConfig = {
    running: {
      dot: "bg-white animate-pulse ring-1 ring-zinc-300/70 dark:ring-white/30",
      label: "Working",
      badge: "bg-zinc-500/15 text-zinc-200 border-zinc-500/30",
    },
    hitl_waiting: {
      dot: "bg-amber-400 animate-pulse",
      label: "Needs input",
      badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    completed: {
      dot: "bg-violet-400",
      label: "Done",
      badge: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    },
    failed: {
      dot: "bg-red-400",
      label: "Failed",
      badge: "bg-red-500/15 text-red-400 border-red-500/30",
    },
  }[status] || {
    dot: "bg-zinc-400",
    label: status,
    badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };

  return (
    <div className="px-4 pt-2">
      {/* ── Compact status bar ────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Live dot + step label */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusConfig.dot}`} />

          {activeStep ? (
            <span className="truncate text-sm text-foreground/90">
              <span className="mr-1.5">{activeStep.emoji}</span>
              {activeStep.label}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{statusConfig.label}</span>
          )}

          {(status === "running" || status === "hitl_waiting") && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>

        {/* Metadata pills */}
        <div className="flex items-center gap-2 shrink-0">
          {elapsed && (
            <span className="text-[11px] tabular-nums text-muted-foreground">{elapsed}</span>
          )}

          {totalNodes > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {doneNodes.length}/{totalNodes}
            </span>
          )}

          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusConfig.badge}`}
          >
            {statusConfig.label}
          </span>

          {/* Actions */}
          {jobId && (status === "running" || status === "hitl_waiting") && (
            <button
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
              disabled={actionBusy !== null}
              onClick={async () => {
                try {
                  setActionBusy("cancel");
                  await cancelPipeline(jobId);
                } finally {
                  setActionBusy(null);
                }
              }}
              title="Cancel pipeline"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {jobId && status === "failed" && (
            <button
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
              disabled={actionBusy !== null}
              onClick={async () => {
                try {
                  setActionBusy("resume");
                  await resumePipeline(jobId);
                } finally {
                  setActionBusy(null);
                }
              }}
              title="Retry pipeline"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Expand/collapse toggle */}
          {totalNodes > 0 && (
            <button
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Hide details" : "Show details"}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded node detail ──────────────────────────────── */}
      {expanded && totalNodes > 0 && (
        <div className="mt-2 mb-1 flex flex-wrap gap-1.5">
          {nodes.map((node, idx) => {
            const isActive = node.status === "running";
            const isDone = node.status === "done";
            return (
              <span
                key={`${node.name}-${idx}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  isActive
                    ? "border-zinc-400/40 bg-zinc-500/10 text-zinc-100"
                    : isDone
                    ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-border/50 bg-transparent text-muted-foreground/60"
                }`}
              >
                {isActive && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {isDone && <span className="text-violet-400">✓</span>}
                {NODE_SHORT[node.name] || prettifyNodeName(node.name)}
                {node.latencyMs ? (
                  <span className="opacity-60">{(node.latencyMs / 1000).toFixed(1)}s</span>
                ) : null}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

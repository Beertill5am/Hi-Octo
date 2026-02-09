"use client";

import { usePipelineStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { useEffect, useMemo, useState } from "react";
import { ReasoningAccordion } from "./ReasoningAccordion";
import { cancelPipeline, resumePipeline } from "@/lib/api";

const NODE_LABELS: Record<string, string> = {
  guardrail: "Safety Check",
  dispatcher: "Routing",
  expander: "Query Expansion",
  query_plan_hitl: "Plan Review",
  search_worker: "Searching",
  deduplicator: "Deduplicating",
  grader: "Grading",
  web_search: "Web Search",
  hitl_approval: "Approval",
  generate: "Generating",
  code_tester: "Testing",
  critic: "Reviewing",
};

const NODE_MICROCOPY: Record<string, { why: string; changed: string }> = {
  guardrail: { why: "Check policy and safety constraints before work.", changed: "Query cleared for execution." },
  dispatcher: { why: "Pick the best route for this request.", changed: "Selected a domain and route." },
  expander: { why: "Broaden recall with query variants.", changed: "Generated parallel retrieval queries." },
  query_plan_hitl: { why: "Get your approval before expensive retrieval.", changed: "Waiting for your decision." },
  search_worker: { why: "Fetch candidate evidence in parallel.", changed: "New retrieval results arrived." },
  deduplicator: { why: "Reduce repeated chunks.", changed: "Merged overlaps and removed duplicates." },
  grader: { why: "Filter to relevant evidence.", changed: "Kept only high-value context." },
  generate: { why: "Synthesize final response from evidence.", changed: "Streaming final answer tokens." },
};

export function AgentStatus() {
  const { status, currentNode, nodes, jobStartedAt, lastLatencyMs, liveReasoning, reasoningDone, jobId } = usePipelineStore();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [actionBusy, setActionBusy] = useState<"cancel" | "resume" | null>(null);

  useEffect(() => {
    const shouldTick = status === "running" || status === "hitl_waiting";
    if (!jobStartedAt || !shouldTick) {
      return;
    }
    const tick = () => setElapsedMs(Date.now() - jobStartedAt);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [jobStartedAt, status]);

  const stageCopy = useMemo(() => {
    if (!currentNode) {
      return null;
    }
    return NODE_MICROCOPY[currentNode] || null;
  }, [currentNode]);

  if (status === "idle") {
    return null;
  }

  const totalMs = status === "completed" ? lastLatencyMs : elapsedMs;
  const latencyLabel = totalMs && totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : "Timing pending";
  const etaLabel = status === "running" ? "~3-12s typical" : "n/a";

  return (
    <Card className="mx-4 mt-4 p-4 bg-muted/50">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">Pipeline Status</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Elapsed {latencyLabel}</span>
          <span className="text-[11px] text-muted-foreground">ETA {etaLabel}</span>
          <span
            className={`rounded-full border px-2 py-1 text-xs ${
              status === "running"
                ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                : status === "hitl_waiting"
                ? "bg-slate-500/20 text-slate-200 border-slate-500/30"
                : status === "completed"
                ? "bg-violet-400/15 text-violet-200 border-violet-400/30"
                : "bg-zinc-500/25 text-zinc-100 border-zinc-500/40"
            }`}
          >
            {status}
          </span>
          {jobId && (status === "running" || status === "hitl_waiting") && (
            <button
              className="rounded border border-border px-2 py-1 text-xs text-foreground/90 hover:bg-muted disabled:opacity-50"
              disabled={actionBusy !== null}
              onClick={async () => {
                try {
                  setActionBusy("cancel");
                  await cancelPipeline(jobId);
                } finally {
                  setActionBusy(null);
                }
              }}
            >
              Cancel
            </button>
          )}
          {jobId && status === "failed" && (
            <button
              className="rounded border border-border px-2 py-1 text-xs text-foreground/90 hover:bg-muted disabled:opacity-50"
              disabled={actionBusy !== null}
              onClick={async () => {
                try {
                  setActionBusy("resume");
                  await resumePipeline(jobId);
                } finally {
                  setActionBusy(null);
                }
              }}
            >
              Resume
            </button>
          )}
        </div>
      </div>

      {currentNode && (
        <div className="mb-3 rounded-md bg-primary/10 p-2">
          <div className="text-sm font-medium">{NODE_LABELS[currentNode] || currentNode}</div>
          {stageCopy && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <div>Why this step: {stageCopy.why}</div>
              <div>What changed: {stageCopy.changed}</div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5 border-l border-border pl-3">
        {nodes.map((node) => (
          <div key={`${node.name}-${node.latencyMs || 0}`} className="text-xs text-muted-foreground">
            <span className="mr-1 text-foreground/80">{NODE_LABELS[node.name] || node.name}</span>
            <span>
              {node.status}
              {node.latencyMs ? ` • ${node.latencyMs.toFixed(0)}ms` : ""}
            </span>
          </div>
        ))}
      </div>

      {liveReasoning.length > 0 && <ReasoningAccordion entries={liveReasoning} done={reasoningDone} />}
    </Card>
  );
}

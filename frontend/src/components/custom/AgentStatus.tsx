"use client";

import { usePipelineStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";

const NODE_LABELS: Record<string, string> = {
  guardrail: "🛡️ Safety Check",
  dispatcher: "🎯 Routing",
  expander: "🔍 Query Expansion",
  search_worker: "📚 Searching",
  deduplicator: "🧹 Deduplicating",
  grader: "⚖️ Grading",
  web_search: "🌐 Web Search",
  hitl_approval: "👤 Awaiting Approval",
  generate: "✍️ Generating",
  code_tester: "🧪 Testing Code",
  critic: "🎭 Reviewing",
};

export function AgentStatus() {
  const { status, currentNode, nodes, jobStartedAt, lastLatencyMs } = usePipelineStore();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const shouldTick = status === "running" || status === "hitl_waiting";
    if (!jobStartedAt || !shouldTick) return;

    const tick = () => setElapsedMs(Date.now() - jobStartedAt);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [jobStartedAt, status]);

  if (status === "idle") {
    return null;
  }

  const totalMs = status === "completed" ? lastLatencyMs : elapsedMs;
  const latencyLabel =
    totalMs && totalMs > 0
      ? `${(totalMs / 1000).toFixed(1)}s ${status === "completed" ? "total" : "elapsed"}`
      : "Timing pending";

  return (
    <Card className="p-4 mx-4 mt-4 bg-muted/50">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">Pipeline Status</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{latencyLabel}</span>
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              status === "running"
                ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
                : status === "hitl_waiting"
                ? "bg-slate-500/20 text-slate-200 border border-slate-500/30"
                : status === "completed"
                ? "bg-violet-400/15 text-violet-200 border border-violet-400/30"
                : "bg-zinc-500/25 text-zinc-100 border border-zinc-500/40"
            }`}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Current node indicator */}
      {currentNode && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 mb-3">
          <span className="animate-pulse">⏳</span>
          <span className="text-sm font-medium">
            {NODE_LABELS[currentNode] || currentNode}
          </span>
        </div>
      )}

      {/* Node history */}
      <div className="flex flex-wrap gap-2">
        {nodes.map((node) => (
          <div
            key={node.name}
            className={`text-xs px-2 py-1 rounded-md ${
              node.status === "running"
                ? "bg-blue-500 text-white animate-pulse"
                : node.status === "done"
                ? "bg-green-500/20 text-green-700 dark:text-green-300"
                : "bg-muted-foreground/20"
            }`}
            title={node.latencyMs ? `${node.latencyMs.toFixed(0)}ms` : undefined}
          >
            {NODE_LABELS[node.name] || node.name}
            {node.latencyMs && (
              <span className="ml-1 opacity-60">{node.latencyMs.toFixed(0)}ms</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

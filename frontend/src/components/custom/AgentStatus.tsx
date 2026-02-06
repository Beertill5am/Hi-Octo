"use client";

import { usePipelineStore } from "@/lib/store";
import { Card } from "@/components/ui/card";

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
  const { status, currentNode, nodes } = usePipelineStore();

  if (status === "idle") {
    return null;
  }

  return (
    <Card className="p-4 mx-4 mt-4 bg-muted/50">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">Pipeline Status</span>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            status === "running"
              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              : status === "hitl_waiting"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              : status === "completed"
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
          }`}
        >
          {status}
        </span>
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

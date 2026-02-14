"use client";

import { ReasoningLogEntry } from "@/lib/store";

interface ReasoningAccordionProps {
  entries: ReasoningLogEntry[];
  done: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  guardrail: "Safety Check",
  input_guardrail: "Input Guard",
  dispatcher: "Routing",
  expander: "Query Expansion",
  expand_query: "Query Expansion",
  query_plan_hitl: "Plan Review",
  query_fanout: "Query Fanout",
  search_worker: "Search",
  deduplicator: "Deduplicate",
  deduplicate: "Deduplicate",
  grader: "Grading",
  grade_documents: "Grade Documents",
  web_search: "Web Search",
  web_search_intent_hitl: "Web Approval",
  retrieval_hitl: "Citation Review",
  draft_review_hitl: "Draft Review",
  generate: "Generation",
  code_tester: "Code Testing",
  critic: "Quality Review",
  pipeline: "Pipeline",
};

function prettifyStageName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function ReasoningAccordion({ entries, done }: ReasoningAccordionProps) {
  const recent = entries.slice(-12);
  const stageSet = new Set<string>();
  for (const entry of recent) {
    stageSet.add(STAGE_LABELS[entry.stage] || prettifyStageName(entry.stage));
  }

  return (
    <details className="mt-4 rounded-md border border-border/70 bg-background/40 p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Model worklog
          </span>
          <span className="text-[11px] text-muted-foreground">
            {done ? "Complete" : "Streaming"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...stageSet].slice(0, 6).map((stage) => (
            <span
              key={stage}
              className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {stage}
            </span>
          ))}
        </div>
      </summary>
      <div className="mt-3 space-y-1.5">
        {recent.map((entry) => (
          <div key={`${entry.seq}-${entry.stage}`} className="text-xs leading-relaxed text-muted-foreground">
            <span className="mr-1 font-mono text-[11px] text-foreground/75">
              {STAGE_LABELS[entry.stage] || prettifyStageName(entry.stage)}
            </span>
            {entry.text}
          </div>
        ))}
      </div>
    </details>
  );
}

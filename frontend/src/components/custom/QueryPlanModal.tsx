"use client";

import { useEffect, useState } from "react";
import { usePipelineStore } from "@/lib/store";
import { approveQueryPlan, rejectQueryPlan } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";

export function QueryPlanModal() {
  const {
    showQueryPlanModal,
    queryPlanData,
    closeQueryPlanModal,
    jobId,
    handleSSEEvent,
  } = usePipelineStore();

  const [queries, setQueries] = useState<string[]>([]);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (showQueryPlanModal && queryPlanData) {
      setQueries(queryPlanData.queries || []);
      setRejectionReason("");
      setIsApproving(false);
      setIsRejecting(false);
      setShowFeedback(false);
      setExpanded(true);
    }
  }, [showQueryPlanModal, queryPlanData]);

  const updateQuery = (idx: number, value: string) => {
    setQueries((prev) => prev.map((q, i) => (i === idx ? value : q)));
  };

  const removeQuery = (idx: number) => {
    setQueries((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveQuery = (idx: number, direction: -1 | 1) => {
    setQueries((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const addQuery = () => {
    setQueries((prev) => [...prev, ""]);
  };

  const regenerateQueries = () => {
    if (!queryPlanData) return;
    const base = queryPlanData.original_query || queryPlanData.query;
    const category = queryPlanData.selected_category || "general";
    setQueries([
      `${base}`,
      `${base} examples`,
      `${base} best practices`,
      `${base} ${category} reference`,
      `${base} troubleshooting`,
    ]);
  };

  const handleApprove = async () => {
    if (!jobId) return;
    const sanitized = queries.map((q) => q.trim()).filter(Boolean);
    if (!sanitized.length) return;

    setIsApproving(true);
    try {
      await approveQueryPlan(jobId, sanitized);
      closeQueryPlanModal();
      handleSSEEvent({ event: "status_change", data: { status: "running" } });
    } catch (error) {
      console.error("Query plan approval failed:", error);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!jobId) return;
    setIsRejecting(true);
    try {
      await rejectQueryPlan(jobId, rejectionReason || "User rejected query plan");
      closeQueryPlanModal();
      handleSSEEvent({
        event: "query_plan_rejected",
        data: { reason: rejectionReason || "User rejected query plan" },
      });
    } catch (error) {
      console.error("Query plan rejection failed:", error);
    } finally {
      setIsRejecting(false);
    }
  };

  if (!showQueryPlanModal || !queryPlanData) return null;

  return (
    <section className="mb-6">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Search className="h-4 w-4 text-violet-400" />
        Search Plan Review
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Review, edit, or reject generated search queries before retrieval.
      </p>

      {/* Context pill */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5">
          Query: <strong className="font-mono text-zinc-200">{queryPlanData.query}</strong>
        </span>
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5">
          Domain: {queryPlanData.selected_category || "unknown"}
        </span>
      </div>

      {/* Collapsible query list */}
      <div className="rounded-md border border-zinc-800 bg-zinc-950/70">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {queries.length} Search Queries
        </button>

        {expanded && (
          <div className="border-t border-zinc-800 px-3 py-2 space-y-1.5">
            {queries.map((query, idx) => (
              <div key={`${idx}-${query}`} className="group flex items-center gap-1.5">
                <button
                  className="shrink-0 cursor-grab text-zinc-600 hover:text-zinc-400 disabled:opacity-30"
                  title="Drag to reorder"
                  disabled={!queryPlanData.can_edit}
                  onDoubleClick={() => moveQuery(idx, idx > 0 ? -1 : 1)}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                <input
                  value={query}
                  onChange={(e) => updateQuery(idx, e.target.value)}
                  disabled={!queryPlanData.can_edit}
                  className="flex-1 rounded border border-zinc-800 bg-black/40 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500 disabled:opacity-50"
                />
                <button
                  onClick={() => removeQuery(idx)}
                  disabled={!queryPlanData.can_edit}
                  className="shrink-0 rounded p-1 text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
                  title="Remove query"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {/* Add / Regenerate */}
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={addQuery}
                disabled={!queryPlanData.can_edit}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-300 hover:border-zinc-700 transition-colors disabled:opacity-30"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
              <button
                onClick={regenerateQueries}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-300 hover:border-zinc-700 transition-colors"
              >
                <RefreshCw className="h-3 w-3" /> Regenerate
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Rejection feedback */}
      {showFeedback ? (
        <div className="mt-3 space-y-2">
          <textarea
            placeholder="Optional feedback (used if you reject)"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="flex min-h-[54px] w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-8 rounded-full px-3"
              onClick={() => setShowFeedback(false)}
            >
              Back
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-full border-zinc-300 bg-white px-3 text-black hover:bg-zinc-100"
              onClick={handleReject}
              disabled={isRejecting || isApproving}
            >
              {isRejecting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-3.5 w-3.5" />
              )}
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <div className="flex-1 text-xs italic text-zinc-500">
            Approve to begin parallel retrieval.
          </div>
          <Button
            variant="outline"
            className="h-8 rounded-full border-zinc-300 bg-white px-3 text-black hover:bg-zinc-100"
            onClick={() => setShowFeedback(true)}
            disabled={isApproving || isRejecting}
          >
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            className="h-8 rounded-full bg-violet-600 px-3 text-white hover:bg-violet-500"
            onClick={handleApprove}
            disabled={isApproving || isRejecting || !queries.some((q) => q.trim())}
          >
            {isApproving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle className="mr-1 h-3.5 w-3.5" />
            )}
            Approve & Continue
          </Button>
        </div>
      )}
    </section>
  );
}

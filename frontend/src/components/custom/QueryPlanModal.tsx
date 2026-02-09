"use client";

import { useEffect, useState } from "react";
import { usePipelineStore } from "@/lib/store";
import { approveQueryPlan, rejectQueryPlan } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { CheckCircle, Loader2, XCircle } from "lucide-react";

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

  useEffect(() => {
    if (showQueryPlanModal && queryPlanData) {
      setQueries(queryPlanData.queries || []);
      setRejectionReason("");
      setIsApproving(false);
      setIsRejecting(false);
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
      if (target < 0 || target >= prev.length) {
        return prev;
      }
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
      handleSSEEvent({ event: "query_plan_rejected", data: { reason: rejectionReason || "User rejected query plan" } });
    } catch (error) {
      console.error("Query plan rejection failed:", error);
    } finally {
      setIsRejecting(false);
    }
  };

  if (!queryPlanData) return null;

  return (
    <Dialog open={showQueryPlanModal}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Query Plan Review</DialogTitle>
          <DialogDescription>
            Review, edit, or reject generated search queries before parallel retrieval.
          </DialogDescription>
        </DialogHeader>

        <Card className="p-3 bg-muted/40 border-border/70">
          <p className="text-sm">
            <span className="text-muted-foreground">Original query:</span>{" "}
            <strong className="font-mono">{queryPlanData.query}</strong>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Selected category: {queryPlanData.selected_category || "unknown"}
          </p>
        </Card>

        <div className="flex-1 overflow-y-auto py-3 space-y-2">
          {queries.map((query, idx) => (
            <div key={`${idx}-${query}`} className="flex gap-2">
              <input
                value={query}
                onChange={(e) => updateQuery(idx, e.target.value)}
                disabled={!queryPlanData.can_edit}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Button variant="outline" onClick={() => moveQuery(idx, -1)} disabled={!queryPlanData.can_edit || idx === 0}>
                Up
              </Button>
              <Button variant="outline" onClick={() => moveQuery(idx, 1)} disabled={!queryPlanData.can_edit || idx === queries.length - 1}>
                Down
              </Button>
              <Button variant="outline" onClick={() => removeQuery(idx)} disabled={!queryPlanData.can_edit}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={addQuery} disabled={!queryPlanData.can_edit}>
            Add query
            </Button>
            <Button variant="outline" onClick={regenerateQueries}>
              Regenerate
            </Button>
          </div>
        </div>

        <textarea
          placeholder="Optional feedback (used if you reject)"
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isApproving || isRejecting}
          >
            {isRejecting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4 mr-2" />
            )}
            Reject
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isApproving || isRejecting || !queries.some((q) => q.trim())}
          >
            {isApproving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Approve & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { usePipelineStore } from "@/lib/store";
import { approveHITL, rejectHITL } from "@/lib/api";
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
import { SearchResultCard } from "./SearchResultCard";
import { AlertTriangle, Search, Clock, Layers, CheckCircle, XCircle, Loader2 } from "lucide-react";

/**
 * Enhanced HITLModal - Professional HITL approval interface
 * with full transparency and strict approval protocol
 */

export function HITLModal() {
  const { showHITLModal, hitlData, closeHITLModal, jobId, handleSSEEvent } = usePipelineStore();
  
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  
  // Reset state when modal opens
  useEffect(() => {
    if (showHITLModal) {
      setRejectionReason("");
      setShowRejectionInput(false);
      setIsApproving(false);
      setIsRejecting(false);
    }
  }, [showHITLModal]);

  const handleApprove = async () => {
    if (!jobId) return;
    setIsApproving(true);
    try {
      await approveHITL(jobId);
      closeHITLModal();
      handleSSEEvent({ event: "status_change", data: { status: "running" } });
    } catch (error) {
      console.error("Approval failed:", error);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!jobId) return;
    setIsRejecting(true);
    try {
      await rejectHITL(jobId, rejectionReason || "User opted not to proceed");
      closeHITLModal();
      handleSSEEvent({ event: "cancelled", data: { reason: rejectionReason || "User rejected" } });
    } catch (error) {
      console.error("Rejection failed:", error);
    } finally {
      setIsRejecting(false);
    }
  };

  // Don't render if no data
  if (!hitlData) return null;
  
  // Format latency for display
  const formatLatency = (ms: number) => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.round(ms)}ms`;
  };

  return (
    <Dialog 
      open={showHITLModal} 
      onOpenChange={(open) => {
        // Prevent closing without explicit action - show rejection input instead
        if (!open && showHITLModal) {
          setShowRejectionInput(true);
        }
      }}
    >
      <DialogContent 
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        // Prevent accidental dismissal
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          setShowRejectionInput(true);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Search className="w-5 h-5 text-primary" />
            Web Search Review
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              {/* Why this was triggered */}
              <Card className="p-3 bg-amber-500/10 border-amber-500/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                      Why Web Search Was Triggered
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {hitlData.reason_for_web_search || "Your knowledge base didn't have sufficient information for this query."}
                    </p>
                  </div>
                </div>
              </Card>
              
              {/* Search metadata */}
              <div className="flex flex-wrap gap-3 text-xs">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted">
                  <Search className="w-3 h-3" />
                  <span>Query: <strong className="font-mono">{hitlData.query}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted">
                  <Layers className="w-3 h-3" />
                  <span>{hitlData.results_shown} of {hitlData.total_results_found} results</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted">
                  <Clock className="w-3 h-3" />
                  <span>Search: {formatLatency(hitlData.search_latency_ms)}</span>
                </div>
                <div className="px-2 py-1 rounded-full bg-primary/10 text-primary">
                  {hitlData.search_depth === "advanced" ? "🔍 Deep search" : "⚡ Quick search"}
                </div>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* AI Summary */}
          {hitlData.ai_summary && (
            <Card className="p-4 bg-primary/5 border-primary/20">
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <span className="text-lg">💡</span>
                AI-Generated Summary
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {hitlData.ai_summary}
              </p>
            </Card>
          )}
          
          {/* Search results */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              📄 Sources Found ({hitlData.search_results?.length || 0})
            </h4>
            {hitlData.search_results?.map((result, i) => (
              <SearchResultCard key={i} result={result} index={i} />
            ))}
          </div>
        </div>

        {/* Footer with strict approval */}
        <DialogFooter className="border-t pt-4 gap-2">
          {showRejectionInput ? (
            /* Rejection feedback form */
            <div className="w-full space-y-3">
              <p className="text-sm text-muted-foreground">
                Would you like to provide feedback on why you&apos;re canceling? (optional)
              </p>
              <textarea
                placeholder="e.g., Results don&apos;t seem relevant, I&apos;ll try a different query..."
                value={rejectionReason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionReason(e.target.value)}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <div className="flex gap-2 justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => setShowRejectionInput(false)}
                >
                  Back to review
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={handleReject}
                  disabled={isRejecting}
                >
                  {isRejecting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4 mr-2" />
                  )}
                  Cancel & Close
                </Button>
              </div>
            </div>
          ) : (
            /* Main action buttons */
            <>
              <div className="flex-1 text-xs text-muted-foreground">
                ⚠️ By approving, Octo will synthesize an answer from these sources.
              </div>
              <Button 
                variant="outline" 
                onClick={() => setShowRejectionInput(true)}
                disabled={isApproving || isRejecting}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </Button>
              <Button 
                onClick={handleApprove}
                disabled={isApproving || isRejecting || !hitlData.search_results?.length}
              >
                {isApproving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Approve & Generate
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

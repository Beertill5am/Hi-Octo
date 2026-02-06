"use client";

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

export function HITLModal() {
  const { showHITLModal, hitlData, closeHITLModal, jobId, handleSSEEvent } =
    usePipelineStore();

  const handleApprove = async () => {
    if (!jobId) return;
    try {
      await approveHITL(jobId);
      closeHITLModal();
      handleSSEEvent({
        event: "status_change",
        data: { status: "running" },
      });
    } catch (error) {
      console.error("Failed to approve:", error);
    }
  };

  const handleReject = async () => {
    if (!jobId) return;
    try {
      await rejectHITL(jobId, "User rejected web search results");
      closeHITLModal();
      handleSSEEvent({
        event: "error",
        data: { error: "Pipeline cancelled by user" },
      });
    } catch (error) {
      console.error("Failed to reject:", error);
    }
  };

  return (
    <Dialog open={showHITLModal} onOpenChange={(open) => !open && closeHITLModal()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>🌐 Web Search Results</DialogTitle>
          <DialogDescription>
            Local knowledge base didn&apos;t have sufficient information. Review these
            web search results before proceeding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-96 overflow-y-auto">
          {/* AI Summary */}
          {hitlData?.ai_summary && (
            <Card className="p-4 bg-primary/10">
              <p className="text-sm font-medium mb-2">💡 AI Summary</p>
              <p className="text-sm">{hitlData.ai_summary}</p>
            </Card>
          )}

          {/* Search Results */}
          <div>
            <p className="text-sm font-medium mb-2">📄 Sources Found</p>
            {hitlData?.search_results.map((result, i) => (
              <Card key={i} className="p-3 mb-2">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {result.title}
                </a>
                <p className="text-xs text-muted-foreground mt-1">
                  {result.snippet}
                </p>
              </Card>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReject}>
            ❌ Cancel
          </Button>
          <Button onClick={handleApprove}>✅ Approve & Generate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { usePipelineStore } from "@/lib/store";
import { startPipeline, subscribeToPipelineStatus, type RunMode } from "@/lib/api";
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

const MODE_LABELS: Record<RunMode, { title: string; description: string }> = {
  rag: {
    title: "Use your knowledge base",
    description: "Search your uploaded documents and build a detailed response.",
  },
  llm: {
    title: "Use built-in knowledge",
    description: "Fast response from the assistant's general knowledge.",
  },
  web: {
    title: "Search the web",
    description: "Find current sources online and summarize them.",
  },
};

export function SourcePickerModal() {
  const [isStarting, setIsStarting] = useState(false);
  const {
    showSourcePicker,
    sourcePickerData,
    closeSourcePicker,
    startJob,
    handleSSEEvent,
    addMessage,
  } = usePipelineStore();

  const handleStart = async (mode: RunMode) => {
    if (!sourcePickerData || isStarting) return;
    setIsStarting(true);
    try {
      const response = await startPipeline(sourcePickerData.query, mode);
      startJob(response.job_id, sourcePickerData.query, { skipUserMessage: true });

      subscribeToPipelineStatus(
        response.job_id,
        handleSSEEvent,
        (error) => {
          console.error("SSE Error:", error);
          handleSSEEvent({ event: "error", data: { error: error.message } });
        }
      );
      closeSourcePicker();
    } catch (error) {
      console.error("Failed to start pipeline:", error);
      addMessage("system", `❌ Error: ${(error as Error).message}`);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Dialog open={showSourcePicker} onOpenChange={(open) => !open && closeSourcePicker()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose how you want me to help</DialogTitle>
          <DialogDescription>
            {sourcePickerData?.query
              ? `Topic: "${sourcePickerData.query}"`
              : "Pick the best option for your question."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Card className="p-4 bg-muted/40">
            <p className="text-sm font-medium">📚 Your knowledge base</p>
            <p className="text-xs text-muted-foreground mt-1">
              {sourcePickerData?.resourceCount ?? 0} resources across{" "}
              {sourcePickerData?.categoryCount ?? 0} categories.
            </p>
          </Card>

          {(["rag", "llm", "web"] as RunMode[]).map((mode) => (
            <Card key={mode} className="p-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{MODE_LABELS[mode].title}</p>
                <p className="text-xs text-muted-foreground">
                  {MODE_LABELS[mode].description}
                </p>
              </div>
              <Button onClick={() => handleStart(mode)} disabled={isStarting}>
                Choose
              </Button>
            </Card>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeSourcePicker}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

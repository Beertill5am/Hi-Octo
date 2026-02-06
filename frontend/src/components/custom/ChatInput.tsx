"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePipelineStore } from "@/lib/store";
import { startPipeline, subscribeToPipelineStatus } from "@/lib/api";

export function ChatInput() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { startJob, handleSSEEvent, status } = usePipelineStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);

    try {
      // Start pipeline
      const response = await startPipeline(query.trim());
      startJob(response.job_id, query.trim());

      // Subscribe to SSE events
      subscribeToPipelineStatus(
        response.job_id,
        handleSSEEvent,
        (error) => {
          console.error("SSE Error:", error);
          handleSSEEvent({ event: "error", data: { error: error.message } });
        }
      );

      setQuery("");
    } catch (error) {
      console.error("Failed to start pipeline:", error);
      handleSSEEvent({
        event: "error",
        data: { error: (error as Error).message },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isDisabled = isLoading || status === "running" || status === "hitl_waiting";

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 p-4 border-t border-border bg-background">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ask about Python concepts..."
        disabled={isDisabled}
        className="flex-1"
      />
      <Button type="submit" disabled={isDisabled}>
        {isLoading ? "Starting..." : "Send"}
      </Button>
    </form>
  );
}

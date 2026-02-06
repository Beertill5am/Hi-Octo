"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePipelineStore } from "@/lib/store";
import { getIntent, startPipeline, subscribeToPipelineStatus } from "@/lib/api";
import { Send, Loader2 } from "lucide-react";

export function ChatInput() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { startJob, handleSSEEvent, status, addMessage } = usePipelineStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);
    const trimmed = query.trim();
    setQuery("");

    try {
      // Add user message immediately
      addMessage("user", trimmed);
      
      // Get intent classification from backend
      const intent = await getIntent(trimmed);

      if (intent.action === "greeting" || intent.action === "clarify") {
        // Show dynamic LLM response with typewriter effect
        addMessage("assistant", intent.message, { isNew: true });
        if (intent.examples.length > 0) {
          setTimeout(() => {
            addMessage("system", `Try: ${intent.examples.join(" • ")}`);
          }, 500);
        }
        return;
      }

      if (intent.action === "choose_source") {
        // Show inline quick replies instead of modal
        addMessage("assistant", "How would you like me to answer?", {
          isNew: true,
          showQuickReplies: true,
          quickReplyData: {
            query: trimmed,
            resourceCount: intent.resource_count,
          },
        });
        return;
      }

      // Direct pipeline execution (fallback)
      const response = await startPipeline(trimmed);
      startJob(response.job_id, trimmed, { skipUserMessage: true });

      subscribeToPipelineStatus(
        response.job_id,
        handleSSEEvent,
        (error) => {
          console.error("SSE Error:", error);
          handleSSEEvent({ event: "error", data: { error: error.message } });
        }
      );
    } catch (error) {
      console.error("Failed to process:", error);
      addMessage("system", `❌ Error: ${(error as Error).message}`);
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
        placeholder="Ask me anything..."
        disabled={isDisabled}
        className="flex-1 bg-muted/50 border-border focus:ring-violet-500"
      />
      <Button 
        type="submit" 
        disabled={isDisabled || !query.trim()}
        className="bg-violet-500 hover:bg-violet-600 text-white"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
}

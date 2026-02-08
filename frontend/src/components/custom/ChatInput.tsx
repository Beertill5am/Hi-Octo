"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePipelineStore } from "@/lib/store";
import { getIntent, startPipeline, subscribeToPipelineStatus } from "@/lib/api";
import { Send, Loader2 } from "lucide-react";

const MAX_INTENT_CONTEXT_MESSAGES = 15;
const MAX_CONTEXT_CHARS_PER_MESSAGE = 240;

export function ChatInput() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { startJob, handleSSEEvent, status, addMessage, messages } = usePipelineStore();

  const truncate = (text: string, maxChars: number): string =>
    text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;

  const buildIntentContext = (currentUserMessage: string): string[] => {
    const history = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const role = m.role === "user" ? "User" : "Assistant";
        return `${role}: ${truncate(m.content.trim(), MAX_CONTEXT_CHARS_PER_MESSAGE)}`;
      });

    history.push(`User: ${truncate(currentUserMessage, MAX_CONTEXT_CHARS_PER_MESSAGE)}`);
    return history.slice(-MAX_INTENT_CONTEXT_MESSAGES);
  };

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
      const context = buildIntentContext(trimmed);
      const intent = await getIntent(trimmed, context);

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
            headerTitle: "Source selection",
            headerDescription: "Pick the best source for this question.",
            showHeader: true,
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
  const statusLabel =
    status === "running"
      ? "Thinking"
      : status === "hitl_waiting"
      ? "Waiting"
      : status === "completed"
      ? "Completed"
      : status === "failed"
      ? "Failed"
      : isLoading
      ? "Thinking"
      : "Idle";
  const statusColor =
    statusLabel === "Thinking"
      ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
      : statusLabel === "Waiting"
      ? "border-slate-500/40 bg-slate-500/15 text-slate-200"
      : statusLabel === "Completed"
      ? "border-violet-400/30 bg-violet-400/10 text-violet-200"
      : statusLabel === "Failed"
      ? "border-zinc-500/50 bg-zinc-500/20 text-zinc-100"
      : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div className="border-t border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">System status</span>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: Compare Python lists vs tuples with examples"
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
    </div>
  );
}

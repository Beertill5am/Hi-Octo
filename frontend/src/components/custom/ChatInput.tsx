"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { usePipelineStore } from "@/lib/store";
import { getIntent, startPipeline, subscribeToPipelineStatus } from "@/lib/api";
import { Send, Loader2 } from "lucide-react";

const MAX_INTENT_CONTEXT_MESSAGES = 15;
const MAX_CONTEXT_CHARS_PER_MESSAGE = 240;

export function ChatInput() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { startJob, handleSSEEvent, status, addMessage, messages } = usePipelineStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  /* Auto-resize the textarea */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);
    const trimmed = query.trim();
    setQuery("");

    try {
      addMessage("user", trimmed);

      const context = buildIntentContext(trimmed);
      const intent = await getIntent(trimmed, context);

      if (intent.action === "greeting" || intent.action === "clarify") {
        addMessage("assistant", intent.message, { isNew: true });
        if (intent.examples.length > 0) {
          setTimeout(() => {
            addMessage("system", `Try: ${intent.examples.join(" • ")}`);
          }, 500);
        }
        return;
      }

      if (intent.action === "choose_source") {
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
      addMessage("system", `Something went wrong — please try again. (${(error as Error).message})`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isDisabled = isLoading || status === "running" || status === "hitl_waiting";

  return (
    <div className="px-4 pb-4 pt-2">
      <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything…"
          disabled={isDisabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-shadow disabled:opacity-50"
        />
        <Button
          type="submit"
          disabled={isDisabled || !query.trim()}
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20 transition-all disabled:opacity-40 disabled:shadow-none"
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

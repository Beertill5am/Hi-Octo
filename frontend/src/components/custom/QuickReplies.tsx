"use client";

import { usePipelineStore } from "@/lib/store";
import { startPipeline, subscribeToPipelineStatus, type RunMode } from "@/lib/api";
import { useState } from "react";
import { BookOpen, Brain, Globe, Loader2 } from "lucide-react";

const MODE_CONFIG: Record<
  RunMode,
  { icon: React.ReactNode; label: string; tooltip: string; color: string }
> = {
  rag: {
    icon: <BookOpen className="h-3.5 w-3.5" />,
    label: "My Docs",
    tooltip: "Grounded answers from your uploaded documents.",
    color:
      "bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border-violet-500/30",
  },
  llm: {
    icon: <Brain className="h-3.5 w-3.5" />,
    label: "Quick Answer",
    tooltip: "Fast model answer — no document retrieval.",
    color:
      "bg-violet-400/10 hover:bg-violet-400/20 text-violet-200 border-violet-400/25",
  },
  web: {
    icon: <Globe className="h-3.5 w-3.5" />,
    label: "Search Web",
    tooltip: "Fresh results from the internet.",
    color:
      "bg-slate-500/10 hover:bg-slate-500/20 text-slate-200 border-slate-500/30",
  },
};

interface QuickRepliesProps {
  messageId?: string;
  query: string;
  resourceCount?: number;
  modes?: RunMode[];
  showHeader?: boolean;
  headerTitle?: string;
  headerDescription?: string;
  onComplete?: () => void;
  disabled?: boolean;
}

export function QuickReplies({
  messageId,
  query,
  resourceCount = 0,
  modes = ["rag", "llm", "web"],
  onComplete,
  disabled = false,
}: QuickRepliesProps) {
  const [isLoading, setIsLoading] = useState<RunMode | null>(null);
  const {
    startJob,
    handleSSEEvent,
    addMessage,
    closeSourcePicker,
    markActionMessageResolved,
  } = usePipelineStore();

  const handleSelect = async (mode: RunMode) => {
    if (isLoading || disabled) return;
    setIsLoading(mode);

    try {
      const response = await startPipeline(query, mode);
      startJob(response.job_id, query, { skipUserMessage: true });
      if (messageId) {
        markActionMessageResolved(messageId);
      }

      subscribeToPipelineStatus(
        response.job_id,
        handleSSEEvent,
        (error) => {
          console.error("SSE Error:", error);
          handleSSEEvent({ event: "error", data: { error: error.message } });
        }
      );

      closeSourcePicker();
      onComplete?.();
    } catch (error) {
      console.error("Failed to start pipeline:", error);
      addMessage("system", `Something went wrong — ${(error as Error).message}`);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {modes.map((mode) => {
        const config = MODE_CONFIG[mode];
        const isThisLoading = isLoading === mode;
        const isDisabled = disabled || isLoading !== null;

        return (
          <button
            key={mode}
            onClick={() => handleSelect(mode)}
            disabled={isDisabled}
            title={config.tooltip}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 ${config.color} ${
              isDisabled && !isThisLoading
                ? "opacity-40 cursor-not-allowed"
                : "cursor-pointer"
            }`}
          >
            {isThisLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              config.icon
            )}
            <span>{config.label}</span>
            {mode === "rag" && resourceCount > 0 && (
              <span className="opacity-60">({resourceCount})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { usePipelineStore } from "@/lib/store";
import { startPipeline, subscribeToPipelineStatus, type RunMode } from "@/lib/api";
import { useState } from "react";
import { BookOpen, Brain, Globe, Loader2 } from "lucide-react";

const MODE_CONFIG: Record<RunMode, { icon: React.ReactNode; label: string; color: string }> = {
  rag: {
    icon: <BookOpen className="h-4 w-4" />,
    label: "My docs",
    color: "bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border-violet-500/30",
  },
  llm: {
    icon: <Brain className="h-4 w-4" />,
    label: "Quick answer",
    color: "bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border-blue-500/30",
  },
  web: {
    icon: <Globe className="h-4 w-4" />,
    label: "Search web",
    color: "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/30",
  },
};

interface QuickRepliesProps {
  query: string;
  resourceCount?: number;
  onComplete?: () => void;
}

export function QuickReplies({ query, resourceCount = 0, onComplete }: QuickRepliesProps) {
  const [isLoading, setIsLoading] = useState<RunMode | null>(null);
  const { startJob, handleSSEEvent, addMessage, closeSourcePicker } = usePipelineStore();

  const handleSelect = async (mode: RunMode) => {
    if (isLoading) return;
    setIsLoading(mode);

    try {
      const response = await startPipeline(query, mode);
      startJob(response.job_id, query, { skipUserMessage: true });

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
      addMessage("system", `❌ Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {(["rag", "llm", "web"] as RunMode[]).map((mode) => {
        const config = MODE_CONFIG[mode];
        const isThisLoading = isLoading === mode;
        
        return (
          <button
            key={mode}
            onClick={() => handleSelect(mode)}
            disabled={isLoading !== null}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 ${config.color} ${
              isLoading !== null && !isThisLoading ? "opacity-50" : ""
            }`}
          >
            {isThisLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              config.icon
            )}
            <span>{config.label}</span>
            {mode === "rag" && resourceCount > 0 && (
              <span className="text-xs opacity-70">({resourceCount})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

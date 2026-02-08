"use client";

import { usePipelineStore } from "@/lib/store";
import { startPipeline, subscribeToPipelineStatus, type RunMode } from "@/lib/api";
import { useState } from "react";
import { BookOpen, Brain, Globe, Info, Loader2 } from "lucide-react";

const MODE_CONFIG: Record<
  RunMode,
  {
    icon: React.ReactNode;
    label: string;
    description: string;
    tooltip: string;
    color: string;
  }
> = {
  rag: {
    icon: <BookOpen className="h-4 w-4" />,
    label: "My docs",
    description: "Uses your uploaded knowledge base first.",
    tooltip: "Best for grounded answers from your own documents.",
    color: "bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border-violet-500/30",
  },
  llm: {
    icon: <Brain className="h-4 w-4" />,
    label: "Quick answer",
    description: "Fast model answer without retrieval.",
    tooltip: "Best for speed when strict citation to your docs is not required.",
    color: "bg-violet-400/10 hover:bg-violet-400/20 text-violet-200 border-violet-400/25",
  },
  web: {
    icon: <Globe className="h-4 w-4" />,
    label: "Search web",
    description: "Pulls fresh information from the web.",
    tooltip: "Best for up-to-date topics and recent events.",
    color: "bg-slate-500/15 hover:bg-slate-500/25 text-slate-200 border-slate-500/35",
  },
};

interface QuickRepliesProps {
  query: string;
  resourceCount?: number;
  modes?: RunMode[];
  showHeader?: boolean;
  headerTitle?: string;
  headerDescription?: string;
  onComplete?: () => void;
}

export function QuickReplies({
  query,
  resourceCount = 0,
  modes = ["rag", "llm", "web"],
  showHeader = true,
  headerTitle = "Choose a source",
  headerDescription = "Pick how Octo should answer this request.",
  onComplete,
}: QuickRepliesProps) {
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
    <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
      {showHeader && (
        <div className="mb-3">
          <p className="text-xs font-semibold tracking-wide text-foreground/90 uppercase">
            {headerTitle}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{headerDescription}</p>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-3">
      {modes.map((mode) => {
        const config = MODE_CONFIG[mode];
        const isThisLoading = isLoading === mode;
        
        return (
          <button
            key={mode}
            onClick={() => handleSelect(mode)}
            disabled={isLoading !== null}
            title={config.tooltip}
            className={`w-full rounded-lg border px-3 py-3 text-left transition-all duration-200 ${config.color} ${
              isLoading !== null && !isThisLoading ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                {isThisLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  config.icon
                )}
                <span>{config.label}</span>
                {mode === "rag" && resourceCount > 0 && (
                  <span className="text-xs opacity-70">({resourceCount})</span>
                )}
              </div>
              <Info className="h-3.5 w-3.5 opacity-60" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{config.description}</p>
          </button>
        );
      })}
      </div>
    </div>
  );
}

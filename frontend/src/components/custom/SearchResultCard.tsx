"use client";

import { Card } from "@/components/ui/card";
import { EnhancedSearchResult } from "@/lib/api";
import { RelevanceBar } from "./RelevanceBar";
import { TypewriterText } from "./TypewriterText";
import { ExternalLink, FileText, Eye } from "lucide-react";
import { useState, useRef, useCallback } from "react";

interface SearchResultCardProps {
  result: EnhancedSearchResult;
  index: number;
  animateTyping?: boolean;
}

export function SearchResultCard({ result, index, animateTyping = false }: SearchResultCardProps) {
  const hasUrl = Boolean(result.url);
  const wordCount = Number(result.word_count || 0);
  const [showPreview, setShowPreview] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  const previewContent =
    (result.full_content || result.snippet || result.citation || "No preview available").slice(0, 700);

  const handleMouseEnter = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const tooltipW = 320;
    const tooltipH = 260;

    let top = rect.bottom + 8;
    let left = rect.right - tooltipW;

    /* Prevent right-side overflow */
    if (left < 8) left = 8;
    if (left + tooltipW > viewportW - 8) left = viewportW - tooltipW - 8;

    /* Prevent bottom overflow – flip above the button */
    if (top + tooltipH > viewportH - 8) {
      top = rect.top - tooltipH - 8;
    }

    setTooltipStyle({ position: "fixed", top, left, width: tooltipW });
    setShowPreview(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowPreview(false);
  }, []);

  return (
    <Card className="relative border-zinc-800/60 bg-black/40 p-3 transition-colors hover:border-violet-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Meta row */}
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-300">
              {result.domain || "doc"}
            </span>
            <span className="text-zinc-500">#{index + 1}</span>
            {result.source_id && <span className="font-mono text-zinc-400">{result.source_id}</span>}
            {typeof result.page === "number" && <span className="text-zinc-400">p.{result.page}</span>}
          </div>

          {/* Title + actions */}
          <div className="mb-1.5 flex items-center gap-2">
            {hasUrl ? (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 text-sm font-medium text-zinc-100 hover:text-violet-300 transition-colors"
              >
                <span className="line-clamp-1">{result.title || "Untitled"}</span>
              </a>
            ) : (
              <p className="line-clamp-1 text-sm font-medium text-zinc-100">{result.title || "Untitled"}</p>
            )}
            {hasUrl && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}

            {/* Preview button – tooltip only on THIS icon */}
            <button
              ref={btnRef}
              type="button"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              className="h-6 w-6 shrink-0 rounded-md border border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:border-violet-400 hover:text-violet-300 flex items-center justify-center transition-colors"
              aria-label="Preview citation"
            >
              <Eye className="h-3 w-3" />
            </button>
          </div>

          <p className="line-clamp-2 text-xs text-zinc-400">{result.snippet}</p>
          {result.citation && (
            <p className="mt-1.5 border-l-2 border-violet-500/40 pl-2 text-xs italic text-zinc-300">
              &quot;
              {animateTyping ? <TypewriterText text={result.citation} speed={2} /> : result.citation}
              &quot;
            </p>
          )}

          <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500">
            <FileText className="h-3 w-3" />
            <span>{wordCount.toLocaleString()} words</span>
          </div>
        </div>

        <div className="shrink-0 pt-0.5">
          <RelevanceBar score={Number(result.relevance_score || 0)} />
        </div>
      </div>

      {/* Fixed-position tooltip – renders outside the card overflow boundaries */}
      {showPreview && (
        <div
          style={tooltipStyle}
          className="z-100 rounded-xl border border-zinc-700/80 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
          onMouseEnter={() => setShowPreview(true)}
          onMouseLeave={() => setShowPreview(false)}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">Preview</span>
            <span className="text-[11px] text-zinc-500">{wordCount.toLocaleString()} words</span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap line-clamp-12">
            {previewContent}
          </p>
        </div>
      )}
    </Card>
  );
}

"use client";

import { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Search, Clock, FileText, RefreshCw, MessageSquare, Eye } from "lucide-react";

/**
 * Inline web search results – clean, modern design
 * Purple/white theme on dark background
 */

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  full_content?: string;
  relevance_score: number;
  domain: string;
  word_count: number;
}

interface WebSearchResultsInlineProps {
  results: SearchResultItem[];
  summary: string;
  query: string;
  totalFound: number;
  searchLatencyMs: number;
  showReportOption?: boolean;
  disabledActions?: boolean;
  onGenerateReport?: () => void;
  onNewQuery?: () => void;
}

function getScoreColor(rank: number): { bar: string; text: string } {
  const purpleShades = [
    { bar: "bg-violet-400", text: "text-violet-400" },
    { bar: "bg-violet-500", text: "text-violet-500" },
    { bar: "bg-purple-400", text: "text-purple-400" },
    { bar: "bg-purple-500", text: "text-purple-500" },
    { bar: "bg-purple-600", text: "text-purple-600" },
    { bar: "bg-fuchsia-500", text: "text-fuchsia-500" },
    { bar: "bg-fuchsia-600", text: "text-fuchsia-600" },
    { bar: "bg-fuchsia-700", text: "text-fuchsia-700" },
    { bar: "bg-fuchsia-800", text: "text-fuchsia-800" },
    { bar: "bg-fuchsia-900", text: "text-fuchsia-900" },
  ];
  return purpleShades[Math.min(rank - 1, 9)];
}

/* ── Single result row with fixed-position preview tooltip ────── */
function ResultRow({ result, rank }: { result: SearchResultItem; rank: number }) {
  const [showPreview, setShowPreview] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const iconRef = useRef<HTMLButtonElement>(null);

  const scorePercent = Math.round(result.relevance_score * 100);
  const colors = getScoreColor(rank);
  const previewText = result.full_content?.slice(0, 500) || result.snippet?.slice(0, 400) || "No preview available";

  const openPreview = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = 320;
    const th = 260;

    let top = rect.bottom + 6;
    let left = rect.right - tw;

    if (left < 8) left = 8;
    if (left + tw > vw - 8) left = vw - tw - 8;
    if (top + th > vh - 8) top = rect.top - th - 6;

    setTooltipStyle({ position: "fixed", top, left, width: tw, zIndex: 100 });
    setShowPreview(true);
  }, []);

  const closePreview = useCallback(() => setShowPreview(false), []);

  return (
    <>
      <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg hover:bg-violet-950/20 transition-colors">
        {/* Rank */}
        <span className="text-xs text-zinc-500 w-4 text-right font-mono shrink-0">{rank}.</span>

        {/* Domain badge */}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-600/80 text-white truncate max-w-24 shrink-0">
          {result.domain}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm text-white truncate" title={result.title}>
          {result.title}
        </span>

        {/* Score bar */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full ${colors.bar} transition-all`} style={{ width: `${scorePercent}%` }} />
          </div>
          <span className={`text-[11px] font-mono ${colors.text} w-9`}>{scorePercent}%</span>
        </div>

        {/* Preview icon */}
        <button
          ref={iconRef}
          type="button"
          onMouseEnter={openPreview}
          onMouseLeave={closePreview}
          className="h-5 w-5 shrink-0 rounded border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-violet-400 hover:text-violet-300 flex items-center justify-center transition-colors"
          aria-label="Preview"
        >
          <Eye className="w-3 h-3" />
        </button>

        {/* External link */}
        {result.url && (
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:text-violet-300 p-0.5 shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Fixed-position tooltip */}
      {showPreview && (
        <div
          style={tooltipStyle}
          className="rounded-xl border border-zinc-700/80 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
          onMouseEnter={() => setShowPreview(true)}
          onMouseLeave={() => setShowPreview(false)}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-600/80 text-white">
              {result.domain}
            </span>
            <span className="text-[11px] text-zinc-500">{result.word_count} words</span>
          </div>
          <h4 className="text-xs font-semibold text-white mb-2 line-clamp-2">{result.title}</h4>
          <p className="text-xs text-zinc-400 leading-relaxed line-clamp-10 whitespace-pre-wrap">
            {previewText}
          </p>
          {result.url && (
            <div className="mt-3 pt-2 border-t border-zinc-800">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
              >
                Open source <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function WebSearchResultsInline({
  results,
  summary,
  query,
  totalFound,
  searchLatencyMs,
  showReportOption = true,
  disabledActions = false,
  onGenerateReport,
  onNewQuery,
}: WebSearchResultsInlineProps) {
  const displayResults = results.slice(0, 10);

  const formatLatency = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  return (
    <Card className="overflow-visible bg-transparent border-0 shadow-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-sm text-white">
            Found {totalFound} sources for &quot;{query}&quot;
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatLatency(searchLatencyMs)}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {displayResults.length}
          </span>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-0.5">
        {displayResults.map((result, i) => (
          <ResultRow key={i} result={result} rank={i + 1} />
        ))}
      </div>

      {/* Summary */}
      <div className="px-3 py-2.5 mt-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-400 mb-1">Summary</p>
        <p className="text-sm leading-relaxed text-zinc-300">{summary}</p>
      </div>

      {/* Actions */}
      {showReportOption && (
        <div className="px-3 py-2 flex gap-2">
          <Button
            size="sm"
            onClick={onGenerateReport}
            disabled={disabledActions}
            className="bg-violet-600 hover:bg-violet-500 text-white text-xs h-7 rounded-lg"
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Generate report
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onNewQuery}
            disabled={disabledActions}
            className="border-violet-600/60 text-violet-400 hover:bg-violet-950 text-xs h-7 rounded-lg"
          >
            <MessageSquare className="w-3 h-3 mr-1.5" />
            New query
          </Button>
        </div>
      )}
    </Card>
  );
}

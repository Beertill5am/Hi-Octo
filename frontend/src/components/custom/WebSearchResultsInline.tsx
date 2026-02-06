"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Search, Clock, FileText, RefreshCw, MessageSquare } from "lucide-react";

/**
 * Inline web search results - compact, clean design
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
  onGenerateReport?: () => void;
  onNewQuery?: () => void;
}

// Purple gradient based on rank (1st = brightest, 10th = darkest)
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

// Compact result row with hover preview on external link
function ResultRow({ result, rank }: { result: SearchResultItem; rank: number }) {
  const [showPreview, setShowPreview] = useState(false);
  
  const scorePercent = Math.round(result.relevance_score * 100);
  const colors = getScoreColor(rank);
  const previewText = result.full_content?.slice(0, 400) || result.snippet?.slice(0, 300) || "No preview available";
  
  return (
    <div className="relative group">
      {/* Compact row - minimal padding */}
      <div className="flex items-center gap-2 py-1.5 px-3 hover:bg-violet-950/30 transition-colors">
        {/* Rank */}
        <span className="text-xs text-gray-500 w-4 text-right font-mono">
          {rank}.
        </span>
        
        {/* Domain badge - purple bg, white text */}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-600 text-white truncate max-w-24">
          {result.domain}
        </span>
        
        {/* Title */}
        <span className="flex-1 text-sm text-white truncate" title={result.title}>
          {result.title}
        </span>
        
        {/* Score bar - purple gradient */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-12 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full ${colors.bar}`} style={{ width: `${scorePercent}%` }} />
          </div>
          <span className={`text-xs font-mono ${colors.text} w-9`}>
            {scorePercent}%
          </span>
        </div>
        
        {/* External link with hover preview */}
        <div 
          className="relative"
          onMouseEnter={() => setShowPreview(true)}
          onMouseLeave={() => setShowPreview(false)}
        >
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:text-violet-300 p-0.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          
          {/* Hover preview tooltip */}
          {showPreview && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 p-3 bg-black rounded-lg shadow-xl">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-violet-600 text-white">
                  {result.domain}
                </span>
                <span className="text-xs text-gray-500">{result.word_count} words</span>
              </div>
              <h4 className="text-xs font-semibold text-white mb-1.5 line-clamp-2">
                {result.title}
              </h4>
              <p className="text-xs text-gray-400 leading-relaxed line-clamp-5">
                {previewText}
              </p>
              <div className="mt-2 pt-1.5 border-t border-gray-800">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  Open <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function WebSearchResultsInline({
  results,
  summary,
  query,
  totalFound,
  searchLatencyMs,
  showReportOption = true,
  onGenerateReport,
  onNewQuery,
}: WebSearchResultsInlineProps) {
  const displayResults = results.slice(0, 10);
  
  const formatLatency = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };
  
  return (
    <Card className="overflow-hidden bg-transparent border-0 shadow-none">
      {/* Header - minimal */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-sm text-white">
            Found {totalFound} sources for &quot;{query}&quot;
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
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
      
      {/* Results list - compact, no dividers */}
      <div>
        {displayResults.map((result, i) => (
          <ResultRow key={i} result={result} rank={i + 1} />
        ))}
      </div>
      
      {/* Summary - no purple bg, just purple label */}
      <div className="px-3 py-2 mt-1">
        <p className="text-xs font-medium text-violet-400 mb-0.5">💡 Summary</p>
        <p className="text-sm leading-relaxed text-gray-300">{summary}</p>
      </div>
      
      {/* Action buttons */}
      {showReportOption && (
        <div className="px-3 py-2 flex gap-2">
          <Button 
            size="sm" 
            onClick={onGenerateReport}
            className="bg-violet-600 hover:bg-violet-500 text-white text-xs h-7"
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Generate report
          </Button>
          <Button 
            size="sm" 
            variant="outline"
            onClick={onNewQuery}
            className="border-violet-600 text-violet-400 hover:bg-violet-950 text-xs h-7"
          >
            <MessageSquare className="w-3 h-3 mr-1.5" />
            New query
          </Button>
        </div>
      )}
    </Card>
  );
}

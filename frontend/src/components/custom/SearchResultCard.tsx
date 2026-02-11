"use client";

import { Card } from "@/components/ui/card";
import { EnhancedSearchResult } from "@/lib/api";
import { RelevanceBar } from "./RelevanceBar";
import { TypewriterText } from "./TypewriterText";
import { ExternalLink, FileText, Square } from "lucide-react";

interface SearchResultCardProps {
  result: EnhancedSearchResult;
  index: number;
  animateTyping?: boolean;
}

export function SearchResultCard({ result, index, animateTyping = false }: SearchResultCardProps) {
  const hasUrl = Boolean(result.url);
  const wordCount = Number(result.word_count || 0);

  return (
    <Card className="group relative overflow-visible border-zinc-800 bg-black/50 p-3 transition-colors hover:border-violet-500/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-300">
              {result.domain || "doc"}
            </span>
            <span className="text-zinc-500">#{index + 1}</span>
            {result.source_id && <span className="font-mono text-zinc-400">{result.source_id}</span>}
            {typeof result.page === "number" && <span className="text-zinc-400">p.{result.page}</span>}
          </div>

          <div className="mb-1.5 flex items-center gap-2">
            {hasUrl ? (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 text-sm font-medium text-zinc-100 hover:text-violet-300"
              >
                <span className="line-clamp-1">{result.title || "Untitled"}</span>
              </a>
            ) : (
              <p className="line-clamp-1 text-sm font-medium text-zinc-100">{result.title || "Untitled"}</p>
            )}
            {hasUrl && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}

            <div className="relative shrink-0">
              <button
                type="button"
                className="h-6 w-6 rounded-sm border border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-violet-400 hover:text-violet-300"
                aria-label="Preview citation"
              >
                <Square className="mx-auto h-3 w-3" />
              </button>
              <div className="pointer-events-none absolute right-0 top-8 z-30 hidden w-80 rounded-md border border-zinc-700 bg-black p-3 text-xs text-zinc-300 shadow-lg md:block opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <p className="mb-1 font-medium text-zinc-100">Preview</p>
                <p className="line-clamp-8 whitespace-pre-wrap">
                  {(result.full_content || result.snippet || result.citation || "No preview available").slice(0, 700)}
                </p>
              </div>
            </div>
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
    </Card>
  );
}

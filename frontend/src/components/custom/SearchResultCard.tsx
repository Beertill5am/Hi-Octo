"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { EnhancedSearchResult } from "@/lib/api";
import { RelevanceBar } from "./RelevanceBar";
import { ContentPreview } from "./ContentPreview";
import { ExternalLink, ChevronDown, ChevronUp, FileText } from "lucide-react";

/**
 * SearchResultCard - Professional search result display
 * with domain badge, relevance score, and expandable preview
 */

interface SearchResultCardProps {
  result: EnhancedSearchResult;
  index: number;
}

export function SearchResultCard({ result, index }: SearchResultCardProps) {
  const [showPreview, setShowPreview] = useState(false);
  
  // Format word count for display
  const formatWordCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };
  
  return (
    <Card className="overflow-hidden transition-all duration-200 hover:shadow-md">
      {/* Main result info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left side: domain badge + title */}
          <div className="flex-1 min-w-0">
            {/* Domain badge */}
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                {result.domain || "web"}
              </span>
              <span className="text-xs text-muted-foreground">
                #{index + 1}
              </span>
            </div>
            
            {/* Title with external link */}
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-1.5 hover:text-primary transition-colors"
            >
              <h4 className="font-medium text-sm leading-tight line-clamp-2 group-hover:underline">
                {result.title}
              </h4>
              <ExternalLink className="w-3 h-3 mt-0.5 opacity-50 group-hover:opacity-100 shrink-0" />
            </a>
            
            {/* Snippet */}
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {result.snippet}
            </p>
          </div>
          
          {/* Right side: relevance score */}
          <div className="shrink-0 text-right">
            <RelevanceBar score={result.relevance_score} />
          </div>
        </div>
        
        {/* Metadata row */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {formatWordCount(result.word_count)} words
            </span>
          </div>
          
          {/* Preview toggle */}
          {result.full_content && (
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            >
              {showPreview ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Hide preview
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Preview content
                </>
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* Expandable preview section */}
      {showPreview && result.full_content && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-muted/30 rounded-lg border border-border/50 max-h-64 overflow-y-auto">
            <ContentPreview content={result.full_content} maxCollapsedLength={1000} />
          </div>
        </div>
      )}
    </Card>
  );
}

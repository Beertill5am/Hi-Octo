"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * ContentPreview - Expandable markdown content preview
 * Shows full page content in collapsible section
 */

interface ContentPreviewProps {
  content: string | null | undefined;
  maxCollapsedLength?: number;
}

export function ContentPreview({ content, maxCollapsedLength = 200 }: ContentPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!content) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No preview available
      </p>
    );
  }
  
  const isLongContent = content.length > maxCollapsedLength;
  const displayContent = isExpanded ? content : content.slice(0, maxCollapsedLength);
  
  return (
    <div className="space-y-2">
      <div 
        className={`
          text-sm prose prose-sm dark:prose-invert max-w-none
          ${!isExpanded && isLongContent ? "line-clamp-4" : ""}
        `}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {displayContent + (isLongContent && !isExpanded ? "..." : "")}
        </ReactMarkdown>
      </div>
      
      {isLongContent && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show full content ({Math.round(content.length / 1000)}k chars)
            </>
          )}
        </button>
      )}
    </div>
  );
}

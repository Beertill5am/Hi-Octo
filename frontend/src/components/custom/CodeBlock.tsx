"use client";

import { CopyButton } from "./CopyButton";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-border bg-muted/50">
      {/* Header with language label and copy button */}
      <div className="flex items-center justify-between border-b border-border bg-muted/80 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {language || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      
      {/* Code content */}
      <pre className="overflow-x-auto p-4 text-sm">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </div>
  );
}

"use client";

import { useRef, useEffect, useState } from "react";
import { usePipelineStore, Message } from "@/lib/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";
import { TypewriterText } from "./TypewriterText";
import { QuickReplies } from "./QuickReplies";
import { WebSearchResultsInline } from "./WebSearchResultsInline";

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const [showFullText, setShowFullText] = useState(!message.isNew);

  const timeString = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleTypewriterComplete = () => {
    setShowFullText(true);
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-6`}>
      <div
        className={`max-w-[85%] ${isUser ? "text-right" : "text-left"}`}
        title={`Sent at ${timeString}`}
      >
        {/* Message content */}
        <div
          className={`text-sm leading-relaxed ${
            isUser
              ? "text-violet-400"
              : isSystem
              ? "text-gray-500 text-xs"
              : "text-foreground"
          }`}
        >
          {/* Inline Web Search Results */}
          {message.webResults ? (
            <WebSearchResultsInline
              results={message.webResults.results}
              summary={message.webResults.summary}
              query={message.webResults.query}
              totalFound={message.webResults.total_found}
              searchLatencyMs={message.webResults.search_latency_ms}
              showReportOption={message.showReportOption}
              onGenerateReport={() => {
                // Focus input and suggest report query
                const input = document.querySelector('input[type="text"]') as HTMLInputElement;
                if (input) {
                  input.value = `Generate a detailed report on: ${message.webResults?.query}`;
                  input.focus();
                }
              }}
              onNewQuery={() => {
                // Clear and focus input
                const input = document.querySelector('input[type="text"]') as HTMLInputElement;
                if (input) {
                  input.value = "";
                  input.focus();
                }
              }}
            />
          ) : isAssistant ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-violet-400 prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground">
              {message.isNew && !showFullText ? (
                <TypewriterText
                  text={message.content}
                  speed={12}
                  onComplete={handleTypewriterComplete}
                />
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: ({ children, ...props }) => {
                      const codeContent =
                        typeof children === "object" &&
                        children &&
                        "props" in children
                          ? (children as { props?: { children?: string } }).props
                              ?.children || ""
                          : String(children);
                      return (
                        <div className="relative group my-4">
                          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton text={String(codeContent)} />
                          </div>
                          <pre
                            {...props}
                            className="overflow-x-auto rounded-lg p-4 text-sm font-mono"
                          >
                            {children}
                          </pre>
                        </div>
                      );
                    },
                    code: ({ className, children, ...props }) => {
                      const isInline = !className;
                      if (isInline) {
                        return (
                          <code
                            className="px-1.5 py-0.5 rounded bg-muted text-violet-400 text-sm"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              )}
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {/* Quick Replies - inline source selection */}
        {message.showQuickReplies && message.quickReplyData && (
          <QuickReplies
            query={message.quickReplyData.query}
            resourceCount={message.quickReplyData.resourceCount}
            modes={message.quickReplyData.modes}
            showHeader={message.quickReplyData.showHeader}
            headerTitle={message.quickReplyData.headerTitle}
            headerDescription={message.quickReplyData.headerDescription}
          />
        )}

        {/* Error recovery quick retries */}
        {message.recoveryData && (
          <QuickReplies
            query={message.recoveryData.query}
            modes={message.recoveryData.modes}
            showHeader
            headerTitle="Quick retry"
            headerDescription="Retry with an alternate source without retyping your question."
          />
        )}
      </div>
    </div>
  );
}

export function ChatHistory() {
  const { messages } = usePipelineStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🐙</div>
          <p className="text-xl font-semibold text-foreground mb-2">
            Hi! I&apos;m Octo
          </p>
          <p className="text-sm text-muted-foreground max-w-md">
            I can answer from your knowledge base, my built-in knowledge, or search the web.
            Try asking &quot;hello&quot; or &quot;what are Python decorators?&quot;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

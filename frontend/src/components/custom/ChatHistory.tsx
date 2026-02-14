"use client";

import { useRef, useEffect, useState } from "react";
import { usePipelineStore, Message } from "@/lib/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";
import { TypewriterText } from "./TypewriterText";
import { QuickReplies } from "./QuickReplies";
import { WebSearchResultsInline } from "./WebSearchResultsInline";
import { HITLModal } from "./HITLModal";
import { QueryPlanModal } from "./QueryPlanModal";
import { CriticSummaryCard } from "./CriticSummaryCard";
import { ChevronDown, ChevronRight } from "lucide-react";

function ThinkingBlock({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-zinc-400">💭</span>
        <span>{label}</span>
      </button>
      {open && (
        <div className="mt-1 ml-5 text-xs italic text-zinc-500 whitespace-pre-wrap border-l-2 border-zinc-800 pl-3">
          {text}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  disableActions,
}: {
  message: Message;
  disableActions: boolean;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const [showFullText, setShowFullText] = useState(!message.isNew);
  const lockInteractiveControls =
    disableActions && Boolean(message.showQuickReplies || message.recoveryData);

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
        className={`max-w-[85%] ${isUser ? "text-right" : "text-left"} ${
          lockInteractiveControls ? "opacity-60 select-none" : ""
        }`}
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
          {message.hitlSnapshot ? (
            <HITLModal snapshot={message.hitlSnapshot} readOnly />
          ) : message.criticSummary ? (
            <CriticSummaryCard summary={message.criticSummary} />
          ) : message.thinkingChapter ? (
            <ThinkingBlock
              label={message.thinkingChapter.phase === "reasoning" ? "Reasoning" : "Thinking"}
              text={message.thinkingChapter.text}
            />
          ) : message.webResults ? (
            <WebSearchResultsInline
              results={message.webResults.results}
              summary={message.webResults.summary}
              query={message.webResults.query}
              totalFound={message.webResults.total_found}
              searchLatencyMs={message.webResults.search_latency_ms}
              showReportOption={message.showReportOption}
              disabledActions={disableActions}
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
            <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-violet-400 prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-a:text-violet-400 hover:prose-a:text-violet-300">
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
            messageId={message.id}
            query={message.quickReplyData.query}
            resourceCount={message.quickReplyData.resourceCount}
            modes={message.quickReplyData.modes}
            disabled={disableActions}
          />
        )}

        {/* Error recovery quick retries */}
        {message.recoveryData && (
          <QuickReplies
            messageId={message.id}
            query={message.recoveryData.query}
            modes={message.recoveryData.modes}
            disabled={disableActions}
          />
        )}
      </div>
    </div>
  );
}

export function ChatHistory() {
  const {
    messages,
    streamingAnswer,
    answerStreaming,
    activeRunId,
    messageActionableMap,
    resolvedActionMessages,
    status,
    showHITLModal,
    graderThinking,
    showQueryPlanModal,
  } = usePipelineStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const disableInlineHistory = status === "hitl_waiting";

  // Auto-scroll only on message boundaries, not every streamed token.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages.length, answerStreaming]);

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
    <div className="octo-scrollbar flex-1 overflow-y-auto px-4 py-6">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          disableActions={
            disableInlineHistory ||
            Boolean(resolvedActionMessages[message.id]) ||
            (Boolean(messageActionableMap[message.id]) &&
              messageActionableMap[message.id] !== activeRunId)
          }
        />
      ))}
      {graderThinking.text && (
        <ThinkingBlock
          label={graderThinking.phase === "reasoning" ? "Reasoning" : "Thinking"}
          text={graderThinking.text}
        />
      )}
      {showQueryPlanModal && <QueryPlanModal />}
      {showHITLModal && <HITLModal />}
      {streamingAnswer && (
        <div className="flex justify-start mb-6">
          <div className="max-w-[85%] text-left">
            <div className="text-sm leading-relaxed text-foreground">
              <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-violet-400 prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-a:text-violet-400 hover:prose-a:text-violet-300">
                <div className="whitespace-pre-wrap break-words">{streamingAnswer}</div>
                {answerStreaming && <span className="animate-pulse">▋</span>}
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

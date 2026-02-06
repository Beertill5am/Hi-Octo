"use client";

import { useRef, useEffect } from "react";
import { usePipelineStore, Message } from "@/lib/store";
import { Card } from "@/components/ui/card";

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <Card
        className={`max-w-[80%] p-4 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isSystem
            ? "bg-muted text-muted-foreground border-dashed"
            : "bg-card"
        }`}
      >
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        <div className="text-xs mt-2 opacity-60">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </Card>
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
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium mb-2">Welcome to Agentic RAG</p>
          <p className="text-sm">Ask a question about Python to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

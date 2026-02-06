import { ChatInput } from "@/components/custom/ChatInput";
import { ChatHistory } from "@/components/custom/ChatHistory";
import { AgentStatus } from "@/components/custom/AgentStatus";
import { HITLModal } from "@/components/custom/HITLModal";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h1 className="text-lg font-semibold">Agentic RAG</h1>
              <p className="text-xs text-muted-foreground">
                Python Knowledge Assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Powered by LangGraph
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        {/* Agent Status Bar */}
        <AgentStatus />

        {/* Chat History */}
        <ChatHistory />

        {/* Input */}
        <ChatInput />
      </div>

      {/* HITL Modal */}
      <HITLModal />
    </div>
  );
}

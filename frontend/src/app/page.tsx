import { ChatInput } from "@/components/custom/ChatInput";
import { ChatHistory } from "@/components/custom/ChatHistory";
import { AgentStatus } from "@/components/custom/AgentStatus";
import { HITLModal } from "@/components/custom/HITLModal";
import { QueryPlanModal } from "@/components/custom/QueryPlanModal";
import { ThemeToggle } from "@/components/custom/ThemeToggle";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white font-bold text-lg shadow-lg">
              🐙
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Hi Octo</h1>
              <p className="text-xs text-muted-foreground">
                Your Knowledge Assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link 
              href="/manage" 
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Manage Content
            </Link>
            <ThemeToggle />
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
      <QueryPlanModal />
    </div>
  );
}

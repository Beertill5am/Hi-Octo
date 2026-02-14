import { ChatInput } from "@/components/custom/ChatInput";
import { ChatHistory } from "@/components/custom/ChatHistory";
import { AgentStatus } from "@/components/custom/AgentStatus";

import { ThemeToggle } from "@/components/custom/ThemeToggle";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 border-b border-border/60 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-indigo-600 text-white font-bold text-lg shadow-lg shadow-violet-500/20">
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

      {/* Chat History – scrollable, fills remaining space */}
      <div className="octo-scrollbar flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full">
          <ChatHistory />
        </div>
      </div>

      {/* Bottom dock: status + input – always visible */}
      <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-md z-40">
        <div className="max-w-4xl mx-auto w-full">
          <AgentStatus />
          <ChatInput />
        </div>
      </div>


    </div>
  );
}

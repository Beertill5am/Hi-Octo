/**
 * Zustand store for pipeline state management
 */
import { create } from "zustand";
import { SSEEvent, HITLPendingData, RunMode } from "./api";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PipelineStatus = 
  | "idle" 
  | "running" 
  | "hitl_waiting" 
  | "completed" 
  | "failed";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  showQuickReplies?: boolean;
  quickReplyData?: {
    query: string;
    resourceCount: number;
    modes?: RunMode[];
    headerTitle?: string;
    headerDescription?: string;
    showHeader?: boolean;
  };
  isNew?: boolean;
  // For inline web search results
  webResults?: {
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      full_content?: string;
      relevance_score: number;
      domain: string;
      word_count: number;
    }>;
    summary: string;
    query: string;
    total_found: number;
    search_latency_ms: number;
  };
  showReportOption?: boolean;
  // For error recovery quick actions
  recoveryData?: {
    query: string;
    modes: RunMode[];
  };
}

export interface AgentNode {
  name: string;
  status: "pending" | "running" | "done" | "error";
  latencyMs?: number;
}

export interface SourcePickerData {
  query: string;
  resourceCount: number;
  categoryCount: number;
  categories: string[];
}


// ═══════════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════════

interface PipelineStore {
  // Pipeline state
  jobId: string | null;
  status: PipelineStatus;
  currentNode: string | null;
  nodes: AgentNode[];
  currentQuery: string | null;
  
  // Latency tracking
  jobStartedAt: number | null;
  lastLatencyMs: number | null;
  
  // Messages
  messages: Message[];
  
  // HITL
  hitlData: HITLPendingData | null;
  showHITLModal: boolean;

  // Source selection
  showSourcePicker: boolean;
  sourcePickerData: SourcePickerData | null;
  
  // Answer
  answer: string | null;
  error: string | null;
  
  // Actions
  startJob: (
    jobId: string,
    topic: string,
    options?: { skipUserMessage?: boolean }
  ) => void;
  handleSSEEvent: (event: SSEEvent) => void;
  addMessage: (role: Message["role"], content: string, options?: Partial<Pick<Message, 'isNew' | 'showQuickReplies' | 'quickReplyData' | 'webResults' | 'showReportOption' | 'recoveryData'>>) => void;
  setHITLData: (data: HITLPendingData) => void;
  closeHITLModal: () => void;
  openSourcePicker: (data: SourcePickerData) => void;
  closeSourcePicker: () => void;
  reset: () => void;
}

const initialState = {
  jobId: null,
  status: "idle" as PipelineStatus,
  currentNode: null,
  nodes: [],
  currentQuery: null,
  jobStartedAt: null,
  lastLatencyMs: null,
  messages: [],
  hitlData: null,
  showHITLModal: false,
  showSourcePicker: false,
  sourcePickerData: null,
  answer: null,
  error: null,
};

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  ...initialState,
  
  startJob: (jobId: string, topic: string, options) => {
    set({
      jobId,
      status: "running",
      currentNode: null,
      nodes: [],
      currentQuery: topic,
      jobStartedAt: Date.now(),
      lastLatencyMs: null,
      hitlData: null,
      showHITLModal: false,
      showSourcePicker: false,
      sourcePickerData: null,
      answer: null,
      error: null,
    });
    
    // Add user message
    if (!options?.skipUserMessage) {
      get().addMessage("user", topic);
    }
    get().addMessage("system", "🚀 Pipeline started...");
  },
  
  handleSSEEvent: (event: SSEEvent) => {
    const { event: eventType, data } = event;
    
    switch (eventType) {
      case "node_start":
        set((state) => ({
          currentNode: data.node as string,
          nodes: [...state.nodes, {
            name: data.node as string,
            status: "running",
          }],
        }));
        break;
        
      case "node_end":
        set((state) => ({
          currentNode: null,
          nodes: state.nodes.map((n) =>
            n.name === data.node
              ? { ...n, status: "done", latencyMs: data.latency_ms as number }
              : n
          ),
        }));
        break;
        
      case "hitl_pending":
        set({
          status: "hitl_waiting",
          hitlData: data as unknown as HITLPendingData,
          showHITLModal: true,
        });
        get().addMessage("system", "⏸️ Waiting for your approval on web search results...");
        break;
        
      case "web_results":
        // Display web search results inline in chat
        console.log("[DEBUG] web_results event received:", data);
        get().addMessage("assistant", "", {
          isNew: true,
          webResults: data as Message["webResults"],
          showReportOption: true,
        });
        break;
        
      case "complete": {
        const startedAt = get().jobStartedAt;
        const elapsed = startedAt ? Date.now() - startedAt : null;
        set({
          status: "completed",
          answer: data.answer as string,
          lastLatencyMs: elapsed,
        });
        // Only add message if web_results didn't already add one
        if (!data.show_report_option) {
          get().addMessage("assistant", data.answer as string, { isNew: true });
        }
        break;
      }
        
      case "error": {
        const query = get().currentQuery;
        set({
          status: "failed",
          error: data.error as string,
        });
        // Add error with recovery quick actions
        get().addMessage("system", `❌ Error: ${data.error}`, {
          recoveryData: query ? { query, modes: ["llm", "web"] as RunMode[] } : undefined,
        });
        break;
      }
        
      case "status_change":
        set({ status: data.status as PipelineStatus });
        break;
    }
  },
  
  addMessage: (role, content, options) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          role,
          content,
          timestamp: new Date(),
          isNew: options?.isNew,
          showQuickReplies: options?.showQuickReplies,
          quickReplyData: options?.quickReplyData,
          webResults: options?.webResults,
          showReportOption: options?.showReportOption,
          recoveryData: options?.recoveryData,
        },
      ],
    }));
  },
  
  setHITLData: (data) => {
    set({ hitlData: data, showHITLModal: true });
  },
  
  closeHITLModal: () => {
    set({ showHITLModal: false });
  },

  openSourcePicker: (data) => {
    set({ showSourcePicker: true, sourcePickerData: data });
  },

  closeSourcePicker: () => {
    set({ showSourcePicker: false, sourcePickerData: null });
  },
  
  reset: () => {
    set(initialState);
  },
}));

/**
 * Zustand store for pipeline state management
 */
import { create } from "zustand";
import { SSEEvent, HITLPendingData } from "./api";

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
  };
  isNew?: boolean;
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
  addMessage: (role: Message["role"], content: string, options?: Partial<Pick<Message, 'isNew' | 'showQuickReplies' | 'quickReplyData'>>) => void;
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
        
      case "complete":
        set({
          status: "completed",
          answer: data.answer as string,
        });
        get().addMessage("assistant", data.answer as string, { isNew: true });
        break;
        
      case "error":
        set({
          status: "failed",
          error: data.error as string,
        });
        get().addMessage("system", `❌ Error: ${data.error}`);
        break;
        
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

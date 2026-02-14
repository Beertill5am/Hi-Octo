/**
 * Zustand store for pipeline state management
 */
import { create } from "zustand";
import { SSEEvent, HITLPendingData, QueryPlanPendingData, RunMode } from "./api";

if (typeof window !== "undefined") {
  window.localStorage.removeItem("octo-pipeline-store");
}

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
  runId?: string;
  isActionable?: boolean;
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
  hitlSnapshot?: HITLSnapshot;
  thinkingChapter?: ThinkingChapter;
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

export interface ReasoningLogEntry {
  stage: string;
  text: string;
  seq: number;
  done: boolean;
}

export interface GraderThinkingState {
  text: string;
  done: boolean;
  phase: string;
}

export interface ThinkingChapter {
  id: string;
  text: string;
  done: boolean;
  phase: string;
  runId?: string;
}

export interface HITLSnapshot {
  data: HITLPendingData;
  decision: "approved" | "rejected";
  decisionReason?: string;
}


// ═══════════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════════

interface PipelineStore {
  // Pipeline state
  jobId: string | null;
  activeRunId: string | null;
  status: PipelineStatus;
  currentNode: string | null;
  nodes: AgentNode[];
  currentQuery: string | null;
  
  // Latency tracking
  jobStartedAt: number | null;
  lastLatencyMs: number | null;
  
  // Messages
  messages: Message[];
  messageActionableMap: Record<string, string>;
  resolvedActionMessages: Record<string, boolean>;
  liveReasoning: ReasoningLogEntry[];
  reasoningDone: boolean;
  graderThinking: GraderThinkingState;
  thinkingChapters: ThinkingChapter[];
  streamingAnswer: string;
  answerStreaming: boolean;
  
  // HITL
  hitlData: HITLPendingData | null;
  showHITLModal: boolean;
  hitlHistory: HITLSnapshot[];
  queryPlanData: QueryPlanPendingData | null;
  showQueryPlanModal: boolean;

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
  addMessage: (role: Message["role"], content: string, options?: Partial<Pick<Message, 'isNew' | 'showQuickReplies' | 'quickReplyData' | 'webResults' | 'showReportOption' | 'recoveryData' | 'hitlSnapshot' | 'thinkingChapter' | 'runId'>>) => void;
  markActionMessageResolved: (messageId: string) => void;
  setHITLData: (data: HITLPendingData) => void;
  archiveCurrentHITL: (decision: "approved" | "rejected", reason?: string) => void;
  closeHITLModal: () => void;
  closeQueryPlanModal: () => void;
  openSourcePicker: (data: SourcePickerData) => void;
  closeSourcePicker: () => void;
  reset: () => void;
}

const initialState = {
  jobId: null,
  activeRunId: null,
  status: "idle" as PipelineStatus,
  currentNode: null,
  nodes: [],
  currentQuery: null,
  jobStartedAt: null,
  lastLatencyMs: null,
  messages: [],
  messageActionableMap: {},
  resolvedActionMessages: {},
  liveReasoning: [],
  reasoningDone: false,
  graderThinking: { text: "", done: false, phase: "grading" },
  thinkingChapters: [],
  streamingAnswer: "",
  answerStreaming: false,
  hitlData: null,
  showHITLModal: false,
  hitlHistory: [],
  queryPlanData: null,
  showQueryPlanModal: false,
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
      activeRunId: jobId,
      status: "running",
      currentNode: null,
      nodes: [],
      currentQuery: topic,
      jobStartedAt: Date.now(),
      lastLatencyMs: null,
      hitlData: null,
      showHITLModal: false,
      queryPlanData: null,
      showQueryPlanModal: false,
      showSourcePicker: false,
      sourcePickerData: null,
      answer: null,
      error: null,
      messageActionableMap: {},
      resolvedActionMessages: {},
      liveReasoning: [],
      reasoningDone: false,
      graderThinking: { text: "", done: false, phase: "grading" },
      thinkingChapters: [],
      streamingAnswer: "",
      answerStreaming: false,
      hitlHistory: [],
    });
    
    // Add user message
    if (!options?.skipUserMessage) {
      get().addMessage("user", topic, { runId: jobId });
    }
    get().addMessage("system", "Working on your request…");
  },
  
  handleSSEEvent: (event: SSEEvent) => {
    const { event: eventType, data } = event;
    
    switch (eventType) {
      case "pipeline_start":
        set({
          activeRunId: String(data.job_id || get().activeRunId || ""),
          jobStartedAt: data.started_at ? Date.parse(String(data.started_at)) : Date.now(),
        });
        break;

      case "node_start":
        set((state) => ({
          currentNode: data.node as string,
          streamingAnswer: data.node === "generate" ? "" : state.streamingAnswer,
          answerStreaming: data.node === "generate" ? true : state.answerStreaming,
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
        {
          const raw = data as Record<string, unknown> & { results?: unknown[]; search_results?: unknown[] };
          const normalizedResults = Array.isArray(raw.search_results)
            ? raw.search_results
            : Array.isArray(raw.results)
            ? raw.results
            : [];
          const normalizedHitlData: HITLPendingData = {
            ...(raw as unknown as HITLPendingData),
            search_results: normalizedResults as HITLPendingData["search_results"],
            results_shown: Number(raw.results_shown ?? normalizedResults.length),
            total_results_found: Number(raw.total_results_found ?? normalizedResults.length),
          };
        set({
          status: "hitl_waiting",
          hitlData: normalizedHitlData,
          showHITLModal: true,
        });
        const hitlType = raw.hitl_type as string | undefined;
        const statusMessage =
          hitlType === "retrieval_review"
            ? "📋 Please review the sources before I generate your answer."
            : hitlType === "pre_web_search_review"
            ? "🌐 Ready to search the web — your approval is needed."
            : hitlType === "reasoning_review"
            ? "🧠 Review my reasoning before I start drafting."
            : hitlType === "blueprint_review"
            ? "📝 Blueprint ready — please review before I write the article."
            : hitlType === "draft_review"
            ? "✏️ Draft reviewed by critic — your feedback is needed."
            : "🔍 Search results ready for your review.";
        get().addMessage("system", statusMessage);
        break;
      }

      case "query_plan_pending":
        set({
          status: "hitl_waiting",
          queryPlanData: data as unknown as QueryPlanPendingData,
          showQueryPlanModal: true,
        });
        get().addMessage("system", "📋 Review the search plan before I begin retrieval.");
        break;

      case "query_plan_approved":
        set({
          status: "running",
          showQueryPlanModal: false,
        });
        get().addMessage("system", "Plan approved — starting retrieval.");
        break;

      case "query_plan_rejected":
        set({
          status: "failed",
          showQueryPlanModal: false,
          answerStreaming: false,
        });
        get().addMessage("system", `Plan declined${data.reason ? `: ${String(data.reason)}` : "."}`);
        break;

      case "answer_token":
        set((state) => ({
          answerStreaming: true,
          streamingAnswer: `${state.streamingAnswer}${String(data.token || "")}`,
        }));
        break;

      case "answer_done":
        set({
          answerStreaming: false,
        });
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

      case "reasoning_chunk":
        set((state) => ({
          liveReasoning: [
            ...state.liveReasoning,
            {
              stage: String(data.stage || "pipeline"),
              text: String(data.text || ""),
              seq: Number(data.seq || state.liveReasoning.length + 1),
              done: false,
            },
          ].slice(-25),
        }));
        break;

      case "reasoning_done":
        set((state) => ({
          reasoningDone: true,
          liveReasoning: state.liveReasoning.map((entry) => ({ ...entry, done: true })),
        }));
        break;

      case "grader_update":
        set((state) => {
          const incoming = String(data.text || "");
          const meta = (data as { meta?: Record<string, unknown> }).meta || {};
          const shouldReplace = Boolean(meta.replace);
          const verified = Array.isArray(meta.verified_citations) ? meta.verified_citations : [];
          const phase = String(data.phase || state.graderThinking.phase || "grading");
          const chapters = [...state.thinkingChapters];
          const chapterMessages = [...state.messages];
          let activeThinking = state.graderThinking;
          const runId = state.activeRunId || state.jobId || undefined;

          if (shouldReplace && activeThinking.text.trim()) {
            const archivedChapter: ThinkingChapter = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              text: activeThinking.text.trim(),
              done: true,
              phase: activeThinking.phase,
              runId,
            };
            chapters.push(archivedChapter);
            chapterMessages.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              role: "assistant",
              content: "",
              timestamp: new Date(),
              runId,
              thinkingChapter: archivedChapter,
            });
            activeThinking = { text: "", done: false, phase };
          }

          const append = incoming
            ? `${activeThinking.text}${activeThinking.text ? "\n" : ""}${incoming}`
            : activeThinking.text;
          let nextThinking: GraderThinkingState = {
            text: append.trim(),
            done: Boolean(data.done),
            phase,
          };

          if (Boolean(data.done) && nextThinking.text) {
            const finishedChapter: ThinkingChapter = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              text: nextThinking.text,
              done: true,
              phase: nextThinking.phase,
              runId,
            };
            chapters.push(finishedChapter);
            chapterMessages.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              role: "assistant",
              content: "",
              timestamp: new Date(),
              runId,
              thinkingChapter: finishedChapter,
            });
            nextThinking = { text: "", done: false, phase: nextThinking.phase };
          }

          const preloadHitl =
            Boolean(data.done) &&
            verified.length > 0 &&
            !state.hitlData;
          const preloadedHitlData = preloadHitl
            ? {
                job_id: state.jobId || "",
                hitl_type: "retrieval_review" as const,
                query: state.currentQuery || "",
                search_results: verified as HITLPendingData["search_results"],
                total_results_found: verified.length,
                results_shown: verified.length,
                search_depth: "local_rag",
                search_latency_ms: 0,
                reason_for_web_search: "Relevant local citations were found. Approve them before generation.",
                requires_approval: true,
                message: "Review retrieved citations before answer generation.",
              }
            : state.hitlData;
          return {
            graderThinking: nextThinking,
            thinkingChapters: chapters.slice(-100),
            messages: chapterMessages,
            hitlData: preloadedHitlData,
          };
        });
        break;
        
      case "complete": {
        const startedAt = get().jobStartedAt;
        const elapsed = startedAt ? Date.now() - startedAt : null;
        const streamed = get().streamingAnswer;
        set({
          status: "completed",
          answer: data.answer as string,
          lastLatencyMs: elapsed,
          reasoningDone: true,
          answerStreaming: false,
        });
        // Persist streamed answer to chat history (web flow already renders its own card).
        if (!data.show_report_option) {
          const finalContent = streamed || String(data.answer || "");
          if (finalContent.trim()) {
            get().addMessage("assistant", finalContent, { isNew: false });
          }
        }
        break;
      }
        
      case "error": {
        const query = get().currentQuery;
        set({
          status: "failed",
          error: data.error as string,
          reasoningDone: true,
          answerStreaming: false,
        });
        // Add error with recovery quick actions
        get().addMessage("system", `Something went wrong — ${data.error}`, {
          recoveryData: query ? { query, modes: ["llm", "web"] as RunMode[] } : undefined,
          runId: get().jobId || undefined,
        });
        break;
      }
        
      case "status_change":
        set({ status: data.status as PipelineStatus });
        break;

      case "cancelled":
        set({ status: "failed", reasoningDone: true, answerStreaming: false });
        get().addMessage("system", `Cancelled${data.reason ? ` — ${String(data.reason)}` : "."}`);
        break;
    }
  },
  
  addMessage: (role, content, options) => {
    set((state) => {
      const isActionable = Boolean(options?.showQuickReplies || options?.recoveryData);
      const runId = options?.runId || state.activeRunId || state.jobId || undefined;
      const message: Message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role,
        content,
        timestamp: new Date(),
        isActionable,
        isNew: options?.isNew,
        showQuickReplies: options?.showQuickReplies,
        quickReplyData: options?.quickReplyData,
        webResults: options?.webResults,
        showReportOption: options?.showReportOption,
        recoveryData: options?.recoveryData,
        hitlSnapshot: options?.hitlSnapshot,
        thinkingChapter: options?.thinkingChapter,
        runId,
      };

      return {
        messages: [...state.messages, message],
        messageActionableMap:
          isActionable && runId
            ? { ...state.messageActionableMap, [message.id]: runId }
            : state.messageActionableMap,
      };
    });
  },

  markActionMessageResolved: (messageId: string) => {
    set((state) => ({
      resolvedActionMessages: {
        ...state.resolvedActionMessages,
        [messageId]: true,
      },
    }));
  },
  
  setHITLData: (data) => {
    set({ hitlData: data, showHITLModal: true });
  },

  archiveCurrentHITL: (decision, reason) => {
    set((state) => {
      if (!state.hitlData) {
        return {};
      }
      const snapshot: HITLSnapshot = {
        data: state.hitlData,
        decision,
        decisionReason: reason,
      };
      const snapshotMessage: Message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        runId: state.activeRunId || state.jobId || undefined,
        hitlSnapshot: snapshot,
      };
      return {
        hitlHistory: [...state.hitlHistory, snapshot],
        messages: [...state.messages, snapshotMessage],
        hitlData: null,
        showHITLModal: false,
      };
    });
  },
  
  closeHITLModal: () => {
    set({ showHITLModal: false });
  },

  closeQueryPlanModal: () => {
    set({ showQueryPlanModal: false });
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





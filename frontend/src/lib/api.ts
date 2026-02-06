/**
 * API client for communicating with the Agentic RAG backend
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface PipelineRunResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface HITLPendingData {
  job_id: string;
  query: string;
  ai_summary?: string;
  search_results: SearchResult[];
  message: string;
}

export interface PipelineResult {
  job_id: string;
  status: string;
  topic: string;
  answer?: string;
  error?: string;
  trace?: Array<Record<string, unknown>>;
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start a pipeline run
 */
export async function startPipeline(topic: string): Promise<PipelineRunResponse> {
  const response = await fetch(`${API_BASE}/pipeline/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to start pipeline: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Subscribe to pipeline status updates via SSE
 */
export function subscribeToPipelineStatus(
  jobId: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/pipeline/status/${jobId}`);
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ event: "message", data });
    } catch {
      onEvent({ event: "message", data: { raw: event.data } });
    }
  };
  
  eventSource.addEventListener("node_start", (event) => {
    onEvent({ event: "node_start", data: JSON.parse((event as MessageEvent).data) });
  });
  
  eventSource.addEventListener("node_end", (event) => {
    onEvent({ event: "node_end", data: JSON.parse((event as MessageEvent).data) });
  });
  
  eventSource.addEventListener("hitl_pending", (event) => {
    onEvent({ event: "hitl_pending", data: JSON.parse((event as MessageEvent).data) });
  });
  
  eventSource.addEventListener("complete", (event) => {
    onEvent({ event: "complete", data: JSON.parse((event as MessageEvent).data) });
    eventSource.close();
  });
  
  eventSource.addEventListener("error", (event) => {
    onEvent({ event: "error", data: JSON.parse((event as MessageEvent).data) });
    eventSource.close();
  });
  
  eventSource.onerror = () => {
    onError?.(new Error("SSE connection error"));
    eventSource.close();
  };
  
  // Return cleanup function
  return () => eventSource.close();
}

/**
 * Get pipeline result
 */
export async function getPipelineResult(jobId: string): Promise<PipelineResult> {
  const response = await fetch(`${API_BASE}/pipeline/result/${jobId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to get result: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Get HITL pending data
 */
export async function getHITLPending(jobId: string): Promise<HITLPendingData> {
  const response = await fetch(`${API_BASE}/hitl/pending/${jobId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to get HITL data: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Approve HITL checkpoint
 */
export async function approveHITL(jobId: string, feedback?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/hitl/approve/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: true, feedback }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to approve: ${response.statusText}`);
  }
}

/**
 * Reject HITL checkpoint
 */
export async function rejectHITL(jobId: string, reason?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/hitl/reject/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: false, feedback: reason }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to reject: ${response.statusText}`);
  }
}

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

export type RunMode = "rag" | "llm" | "web";

export interface IntentResponse {
  action: "greeting" | "clarify" | "choose_source" | "run_pipeline";
  message: string;
  examples: string[];
  resource_count: number;
  category_count: number;
  categories: string[];
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
export async function startPipeline(
  topic: string,
  mode: RunMode = "rag"
): Promise<PipelineRunResponse> {
  const response = await fetch(`${API_BASE}/pipeline/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, mode }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to start pipeline: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Classify intent before running the pipeline
 */
export async function getIntent(query: string): Promise<IntentResponse> {
  const response = await fetch(`${API_BASE}/pipeline/intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Failed to classify intent: ${response.statusText}`);
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

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT MANAGEMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface Category {
  name: string;
  description?: string;
  resource_count: number;
}

export interface Resource {
  id: string;
  filename: string;
  original_name?: string;
  category: string;
  source_type: string;
  title?: string;
  author?: string;
  published_date?: string;
  source_url?: string;
  subject?: string;
  topic?: string;
  tags?: string[];
  file_size?: number;
  chunk_count?: number;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface WebImportPayload {
  url: string;
  category: string;
  title?: string;
  author?: string;
  published_date?: string;
  subject?: string;
  topic?: string;
  tags?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT MANAGEMENT API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * List all categories
 */
export async function getCategories(): Promise<Category[]> {
  const response = await fetch(`${API_BASE}/categories`);
  if (!response.ok) {
    throw new Error(`Failed to fetch categories: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new category
 */
export async function createCategory(name: string, description?: string): Promise<Category> {
  const response = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create category: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete a category
 */
export async function deleteCategory(name: string, deleteResources: boolean = false): Promise<void> {
  const response = await fetch(`${API_BASE}/categories/${encodeURIComponent(name)}?delete_resources=${deleteResources}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Failed to delete category: ${response.statusText}`);
  }
}

/**
 * List resources, optionally filtered by category
 */
export async function getResources(category?: string): Promise<Resource[]> {
  const url = category 
    ? `${API_BASE}/content?category=${encodeURIComponent(category)}`
    : `${API_BASE}/content`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch resources: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Upload a file
 */
export async function uploadFile(
  file: File,
  category: string,
  metadata?: Partial<Omit<Resource, 'id' | 'filename' | 'category' | 'source_type' | 'status'>>
): Promise<Resource> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);
  if (metadata?.title) formData.append("title", metadata.title);
  if (metadata?.author) formData.append("author", metadata.author);
  if (metadata?.published_date) formData.append("published_date", metadata.published_date);
  if (metadata?.source_url) formData.append("source_url", metadata.source_url);
  if (metadata?.subject) formData.append("subject", metadata.subject);
  if (metadata?.topic) formData.append("topic", metadata.topic);
  if (metadata?.tags) formData.append("tags", metadata.tags.join(","));

  const response = await fetch(`${API_BASE}/content/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to upload file: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Import content from a URL
 */
export async function importFromUrl(payload: WebImportPayload): Promise<Resource> {
  const response = await fetch(`${API_BASE}/content/web-import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to import URL: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete a resource
 */
export async function deleteResource(resourceId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/content/${resourceId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Failed to delete resource: ${response.statusText}`);
  }
}

/**
 * Reindex a resource
 */
export async function reindexResource(resourceId: string): Promise<Resource> {
  const response = await fetch(`${API_BASE}/content/${resourceId}/reindex`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Failed to reindex resource: ${response.statusText}`);
  }
  return response.json();
}


"""
Pydantic Schemas for API Request/Response Models
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class JobStatus(str, Enum):
    """Pipeline job status."""
    PENDING = "pending"
    RUNNING = "running"
    HITL_WAITING = "hitl_waiting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RunMode(str, Enum):
    """Execution mode for the pipeline."""
    RAG = "rag"
    LLM = "llm"
    WEB = "web"


# ═══════════════════════════════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class PipelineRunRequest(BaseModel):
    """Request to start a pipeline run."""
    topic: str = Field(..., description="The topic/query to process")
    categories: Optional[List[str]] = Field(None, description="Override available categories")
    mode: RunMode = Field(default=RunMode.RAG, description="Execution mode")


class IntentRequest(BaseModel):
    """Request to classify user intent before running pipeline."""
    query: str = Field(..., description="Raw user input")
    context: Optional[List[str]] = Field(
        None,
        description="Recent conversation context as short role-prefixed lines"
    )


class IntentResponse(BaseModel):
    """Response for intent classification."""
    action: str = Field(..., description="greeting | clarify | choose_source | run_pipeline")
    message: str = Field(..., description="UX message to show user")
    examples: List[str] = Field(default_factory=list, description="Example prompts")
    resource_count: int = 0
    category_count: int = 0
    categories: List[str] = Field(default_factory=list)


class HITLDecision(BaseModel):
    """HITL approval/rejection decision."""
    approved: bool = Field(..., description="Whether user approved")
    feedback: Optional[str] = Field(None, description="Optional user feedback")
    edited_text: Optional[str] = Field(
        None,
        description="Optional user-edited text used by reasoning_review/blueprint_review HITL",
    )


class QueryPlanDecision(BaseModel):
    """Decision for post-expander query-plan checkpoint."""
    approved: bool = Field(..., description="Whether user approved query plan")
    edited_queries: Optional[List[str]] = Field(
        None,
        description="Optional edited list of queries to use when approved"
    )
    feedback: Optional[str] = Field(None, description="Optional approval/rejection feedback")

class CategoryCreateRequest(BaseModel):
    name: str = Field(..., description="Category name")
    description: Optional[str] = Field(None, description="Optional category description")


class CategoryResponse(BaseModel):
    name: str
    description: Optional[str] = None
    resource_count: int = 0


class ResourceMetadata(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    published_date: Optional[str] = None
    source_url: Optional[str] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    tags: Optional[List[str]] = None


class ResourceResponse(ResourceMetadata):
    id: str
    filename: str
    original_name: Optional[str] = None
    category: str
    source_type: str
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    file_hash: Optional[str] = None
    chunk_count: Optional[int] = None
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WebImportRequest(ResourceMetadata):
    url: str = Field(..., description="URL to import")
    category: str = Field(..., description="Category to assign")


class ResourceUpdateRequest(ResourceMetadata):
    category: Optional[str] = None
    status: Optional[str] = None

# ═══════════════════════════════════════════════════════════════════════════════
# RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class PipelineRunResponse(BaseModel):
    """Response after starting a pipeline run."""
    job_id: str
    status: JobStatus
    message: str


class SearchResultItem(BaseModel):
    """A single web search result (basic)."""
    title: str
    url: str
    snippet: str


class EnhancedSearchResult(BaseModel):
    """
    Enhanced search result with full transparency metadata.
    Used in HITL approval flow for professional UX.
    """
    title: str = Field(..., description="Page title")
    url: str = Field(..., description="Full URL")
    snippet: str = Field(..., description="Short snippet for card display")
    full_content: Optional[str] = Field(None, description="Full markdown content for preview")
    relevance_score: float = Field(0.0, ge=0.0, le=1.0, description="Relevance score 0.0-1.0")
    domain: str = Field("", description="Extracted domain (e.g., python.org)")
    word_count: int = Field(0, description="Content word count")
    retrieved_at: str = Field("", description="ISO timestamp when retrieved")
    source_id: Optional[str] = Field(None, description="Stable citation/source id like S1")
    citation: Optional[str] = Field(None, description="Short quoted evidence text")
    page: Optional[int] = Field(None, description="1-based page number when available")


class HITLPendingData(BaseModel):
    """
    Data shown to user during HITL checkpoint.
    Provides full transparency for informed decision-making.
    """
    job_id: str
    query: str
    hitl_type: str = Field(
        "web_search_review",
        description="web_search_review | retrieval_review | pre_web_search_review | reasoning_review | blueprint_review | draft_review",
    )
    ai_summary: Optional[str] = None
    reasoning_text: Optional[str] = None
    blueprint_text: Optional[str] = None
    editable_text: Optional[str] = None
    # Draft review fields (iterative report generation)
    current_draft: Optional[str] = Field(None, description="Current draft text for review")
    critic_feedback: List[str] = Field(default_factory=list, description="List of critic feedback items")
    critic_praise: Optional[str] = Field(None, description="What the critic says should be preserved")
    critic_score: Optional[int] = Field(None, ge=0, le=10, description="Critic score 0-10")
    code_execution_logs: Optional[str] = Field(None, description="Code testing output logs")
    iteration_count: int = Field(0, description="Current revision iteration number")
    search_results: List[EnhancedSearchResult] = Field(default_factory=list)
    # Transparency metadata
    total_results_found: int = Field(0, description="Total results from search")
    results_shown: int = Field(0, description="Number shown after filtering")
    search_depth: str = Field("basic", description="basic or advanced")
    search_latency_ms: float = Field(0.0, description="How long search took")
    reason_for_web_search: str = Field(
        "", 
        description="WHY web search was triggered (transparency)"
    )
    requires_approval: bool = Field(True, description="Must wait for explicit approval")
    message: str = "Review search results before generation"


class PipelineResultResponse(BaseModel):
    """Final pipeline result."""
    job_id: str
    status: JobStatus
    topic: str
    answer: Optional[str] = None
    error: Optional[str] = None
    trace: Optional[List[Dict[str, Any]]] = None


class QueryPlanPendingData(BaseModel):
    """Data shown to user for query-plan review checkpoint."""
    job_id: str
    original_query: str
    query: str
    selected_category: str
    queries: List[str] = Field(default_factory=list)
    can_edit: bool = True
    requires_approval: bool = True
    message: str = "Review generated search queries before retrieval"


# ═══════════════════════════════════════════════════════════════════════════════
# SSE EVENT MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class SSEEvent(BaseModel):
    """Base SSE event structure."""
    event: str
    timestamp: datetime = Field(default_factory=datetime.now)
    data: Dict[str, Any] = {}


class NodeStartEvent(SSEEvent):
    """Emitted when a node starts executing."""
    event: str = "node_start"
    node: str
    

class NodeEndEvent(SSEEvent):
    """Emitted when a node finishes."""
    event: str = "node_end"
    node: str
    latency_ms: float


class HITLPendingEvent(SSEEvent):
    """Emitted when pipeline reaches HITL checkpoint."""
    event: str = "hitl_pending"
    hitl_data: HITLPendingData


class ReasoningChunkEvent(SSEEvent):
    """Incremental semantic reasoning line for live UX transparency."""
    event: str = "reasoning_chunk"
    stage: str
    text: str
    seq: int


class ReasoningDoneEvent(SSEEvent):
    """Signals that reasoning stream for current run is complete."""
    event: str = "reasoning_done"
    stage: str
    summary: str


class QueryPlanPendingEvent(SSEEvent):
    """Emitted when post-expander query plan requires user review."""
    event: str = "query_plan_pending"
    job_id: str
    original_query: str
    selected_category: str
    queries: List[str] = Field(default_factory=list)
    can_edit: bool = True


class AnswerTokenEvent(SSEEvent):
    """Token stream event during answer generation."""
    event: str = "answer_token"
    token: str
    seq: int


class CompleteEvent(SSEEvent):
    """Emitted when pipeline completes."""
    event: str = "complete"
    answer: str

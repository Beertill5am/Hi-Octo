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


# ═══════════════════════════════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class PipelineRunRequest(BaseModel):
    """Request to start a pipeline run."""
    topic: str = Field(..., description="The topic/query to process")
    categories: Optional[List[str]] = Field(None, description="Override available categories")


class HITLDecision(BaseModel):
    """HITL approval/rejection decision."""
    approved: bool = Field(..., description="Whether user approved")
    feedback: Optional[str] = Field(None, description="Optional user feedback")


# ═══════════════════════════════════════════════════════════════════════════════
# RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class PipelineRunResponse(BaseModel):
    """Response after starting a pipeline run."""
    job_id: str
    status: JobStatus
    message: str


class SearchResultItem(BaseModel):
    """A single web search result."""
    title: str
    url: str
    snippet: str


class HITLPendingData(BaseModel):
    """Data shown to user during HITL checkpoint."""
    job_id: str
    query: str
    ai_summary: Optional[str] = None
    search_results: List[SearchResultItem] = []
    estimated_tokens: Optional[int] = None
    message: str = "Review search results before generation"


class PipelineResultResponse(BaseModel):
    """Final pipeline result."""
    job_id: str
    status: JobStatus
    topic: str
    answer: Optional[str] = None
    error: Optional[str] = None
    trace: Optional[List[Dict[str, Any]]] = None


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


class CompleteEvent(SSEEvent):
    """Emitted when pipeline completes."""
    event: str = "complete"
    answer: str

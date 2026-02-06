"""
Pipeline Runner - Async wrapper for LangGraph pipeline
Handles job management, state tracking, and event streaming.
"""
import sys
import os
import asyncio
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, Callable, AsyncGenerator
from dataclasses import dataclass, field
from enum import Enum
from langchain_ollama import ChatOllama
from web_search_agent import WebSearchAgent, extract_domain
import time

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    HITL_WAITING = "hitl_waiting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class PipelineJob:
    """Tracks a single pipeline execution."""
    job_id: str
    topic: str
    mode: str = "rag"
    status: JobStatus = JobStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    
    # Results
    answer: Optional[str] = None
    error: Optional[str] = None
    trace: list = field(default_factory=list)
    
    # HITL state
    hitl_data: Optional[Dict[str, Any]] = None
    hitl_event: Optional[asyncio.Event] = None
    hitl_approved: Optional[bool] = None
    hitl_rejection_reason: Optional[str] = None  # User feedback on rejection
    
    # Event streaming
    event_queue: asyncio.Queue = field(default_factory=asyncio.Queue)


class PipelineRunner:
    """Manages pipeline jobs and provides async interface for API."""
    
    def __init__(self):
        self.jobs: Dict[str, PipelineJob] = {}
        self._pipeline_ready = False
        self._app = None
        self._retriever = None
        self._vectorstore = None
        self._categories = []
    
    def initialize_pipeline(self):
        """
        Lazy-load the pipeline components.
        Called once on first job to avoid slow startup.
        """
        if self._pipeline_ready:
            return
        
        try:
            print("🔄 Loading pipeline (this may take a moment)...")
            
            # Import pipeline components
            from modelTest5 import (
                app, 
                build_retriever, 
                get_available_categories,
                set_vectorstore,
                SOURCE_FILES
            )
            
            self._app = app
            
            # Build retriever and vectorstore on-demand
            print("📚 Building vector store...")
            self._retriever, self._vectorstore = build_retriever(SOURCE_FILES, "python")
            self._categories = get_available_categories(self._vectorstore)
            
            # CRITICAL: Set the global vectorstore for search_worker_node
            set_vectorstore(self._vectorstore)
            
            self._pipeline_ready = True
            print(f"✅ Pipeline initialized with {len(self._categories)} categories")
        except Exception as e:
            print(f"❌ Failed to initialize pipeline: {e}")
            raise

    
    async def start_job(self, topic: str, categories: list = None, mode: str = "rag") -> str:
        """
        Start a new pipeline job.
        Returns job_id immediately, runs pipeline in background.
        """
        job_id = str(uuid.uuid4())[:8]
        
        # Create job with event queue
        job = PipelineJob(
            job_id=job_id,
            topic=topic,
            mode=mode,
            hitl_event=asyncio.Event()
        )
        self.jobs[job_id] = job
        
        # Start pipeline in background
        asyncio.create_task(self._run_pipeline(job, categories))
        
        return job_id
    
    async def _run_pipeline(self, job: PipelineJob, categories: list = None):
        """Execute the pipeline and emit events."""
        try:
            job.status = JobStatus.RUNNING
            await self._emit_event(job, "status_change", {"status": "running"})
            
            if job.mode == "llm":
                await self._run_llm_job(job)
                return

            if job.mode == "web":
                await self._run_web_job(job)
                return

            # Initialize pipeline if needed
            self.initialize_pipeline()
            
            # Prepare inputs
            inputs = {
                "topic": job.topic,
                "available_categories": categories or self._categories,
                "retry_count": 0,
                "revision_count": 0
            }
            
            await self._emit_event(job, "pipeline_start", {"topic": job.topic})
            
            # Run pipeline (blocking - we wrap with custom callbacks later)
            # For now, run synchronously in executor
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self._app.invoke(inputs, {"recursion_limit": 50})
            )
            
            # Extract answer
            job.answer = result.get("answer", "No answer generated")
            job.status = JobStatus.COMPLETED
            
            await self._emit_event(job, "complete", {"answer": job.answer})
            
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error = str(e)
            await self._emit_event(job, "error", {"error": str(e)})

    async def _run_llm_job(self, job: PipelineJob):
        """Run a lightweight LLM-only response (no retrieval)."""
        await self._emit_event(job, "pipeline_start", {"topic": job.topic, "mode": "llm"})
        llm = ChatOllama(model="qwen3:8b", temperature=0.3, num_ctx=4096)
        prompt = (
            "You are Octo, a friendly assistant. Answer clearly and briefly. "
            "If the user is vague, ask a clarifying question.\n\n"
            f"User question: {job.topic}"
        )
        response = llm.invoke(prompt)
        job.answer = response.content if response else "No answer generated."
        job.status = JobStatus.COMPLETED
        await self._emit_event(job, "complete", {"answer": job.answer})

    async def _run_web_job(self, job: PipelineJob):
        """
        Run a web-search response - streams results directly to chat.
        No approval needed - user already chose web search explicitly.
        """
        await self._emit_event(job, "pipeline_start", {"topic": job.topic, "mode": "web"})
        await self._emit_event(job, "node_start", {"node": "web_search"})
        
        # Track timing for transparency
        search_start = time.time()
        
        search_agent = WebSearchAgent()
        search_response = search_agent.search(job.topic, expand=False)
        
        search_latency_ms = (time.time() - search_start) * 1000
        
        raw_results = search_response.get("results", [])
        ai_summary = search_response.get("answer")
        
        await self._emit_event(job, "node_end", {
            "node": "web_search", 
            "latency_ms": search_latency_ms,
            "results_count": len(raw_results)
        })
        
        if not raw_results:
            job.answer = "I couldn't find relevant web results. Try rephrasing or use your local knowledge base."
            job.status = JobStatus.COMPLETED
            await self._emit_event(job, "complete", {"answer": job.answer})
            return
        
        # Build enhanced results with full metadata
        enhanced_results = []
        for r in raw_results[:10]:  # Up to 10 results
            url = r.url if hasattr(r, 'url') else r.get('url', '')
            content = r.content if hasattr(r, 'content') else r.get('content', '')
            raw_content = r.raw_content if hasattr(r, 'raw_content') else r.get('raw_content', content)
            enhanced_results.append({
                "title": r.title if hasattr(r, 'title') else r.get('title', 'Untitled'),
                "url": url,
                "snippet": content[:300] if content else "",
                "full_content": raw_content[:5000] if raw_content else content[:2000],
                "relevance_score": r.score if hasattr(r, 'score') else r.get('score', 0.0),
                "domain": extract_domain(url),
                "word_count": len((raw_content or content or "").split()),
                "retrieved_at": r.timestamp if hasattr(r, 'timestamp') else r.get('timestamp', "")
            })
        
        # Sort by relevance score (highest first)
        enhanced_results.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
        
        # Generate AI summary if not provided by Tavily
        if not ai_summary:
            await self._emit_event(job, "node_start", {"node": "summarize"})
            
            snippets = "\n".join(
                f"- {r['title']}: {r['snippet'][:200]}" 
                for r in enhanced_results[:5]
            )
            
            llm = ChatOllama(model="qwen3:8b", temperature=0.3, num_ctx=4096)
            summary_prompt = (
                "Based on these web search results, write a brief 2-3 sentence summary "
                "of the key findings. Be concise and informative.\n\n"
                f"Query: {job.topic}\n\n"
                f"Results:\n{snippets}"
            )
            summary_response = llm.invoke(summary_prompt)
            ai_summary = summary_response.content if summary_response else "Summary not available."
            
            await self._emit_event(job, "node_end", {"node": "summarize"})
        
        # Emit web results directly to chat (no HITL - inline display)
        await self._emit_event(job, "web_results", {
            "results": enhanced_results,
            "summary": ai_summary,
            "total_found": len(raw_results),
            "query": job.topic,
            "search_latency_ms": search_latency_ms
        })
        
        # Mark job complete - results are now displayed, user can choose next action
        job.answer = ai_summary  # Store summary as the answer
        job.status = JobStatus.COMPLETED
        await self._emit_event(job, "complete", {
            "answer": ai_summary,
            "results_count": len(enhanced_results),
            "show_report_option": True  # Frontend will show "Generate report" option
        })
    
    async def _emit_event(self, job: PipelineJob, event_type: str, data: dict):
        """Push event to job's queue for SSE streaming."""
        event = {
            "event": event_type,
            "timestamp": datetime.now().isoformat(),
            "data": data
        }
        job.trace.append(event)
        await job.event_queue.put(event)
    
    async def stream_events(self, job_id: str) -> AsyncGenerator[dict, None]:
        """
        Async generator that yields events for SSE streaming.
        """
        job = self.jobs.get(job_id)
        if not job:
            yield {"event": "error", "data": {"error": "Job not found"}}
            return
        
        while True:
            try:
                # Wait for event with timeout
                event = await asyncio.wait_for(
                    job.event_queue.get(),
                    timeout=30.0
                )
                yield event
                
                # Stop streaming on terminal events
                if event["event"] in ["complete", "error", "cancelled"]:
                    break
                    
            except asyncio.TimeoutError:
                # Send keepalive
                yield {"event": "keepalive", "data": {}}
    
    def get_job(self, job_id: str) -> Optional[PipelineJob]:
        """Get job by ID."""
        return self.jobs.get(job_id)
    
    async def approve_hitl(self, job_id: str, feedback: str = None) -> bool:
        """Approve HITL checkpoint and continue pipeline."""
        job = self.jobs.get(job_id)
        if not job or job.status != JobStatus.HITL_WAITING:
            return False
        
        job.hitl_approved = True
        job.hitl_event.set()  # Unblock pipeline
        await self._emit_event(job, "hitl_approved", {"feedback": feedback})
        return True
    
    async def reject_hitl(self, job_id: str, reason: str = None) -> bool:
        """Reject HITL checkpoint and cancel pipeline."""
        job = self.jobs.get(job_id)
        if not job or job.status != JobStatus.HITL_WAITING:
            return False
        
        job.hitl_approved = False
        job.status = JobStatus.CANCELLED
        job.hitl_event.set()
        await self._emit_event(job, "cancelled", {"reason": reason or "User rejected"})
        return True


# Global runner instance
runner = PipelineRunner()

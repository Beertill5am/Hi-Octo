"""
Pipeline Runner - Async wrapper for LangGraph pipeline
Handles job management, state tracking, and event streaming.
"""
import sys
import os
import asyncio
import threading
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
    hitl_event: Optional[threading.Event] = None
    hitl_approved: Optional[bool] = None
    hitl_rejection_reason: Optional[str] = None  # User feedback on rejection
    hitl_edited_text: Optional[str] = None
    # Query plan HITL state
    query_plan_data: Optional[Dict[str, Any]] = None
    query_plan_event: Optional[threading.Event] = None
    query_plan_approved: Optional[bool] = None
    query_plan_edited_queries: Optional[list] = None
    query_plan_rejection_reason: Optional[str] = None
    
    # Event streaming
    event_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    event_seq: int = 0
    reasoning_seq: int = 0
    answer_token_seq: int = 0
    answer_stream_buffer: str = ""
    last_stream_emit_ts: float = 0.0


class PipelineRunner:
    """Manages pipeline jobs and provides async interface for API."""
    QUERY_PLAN_WAIT_TIMEOUT_S = None
    THREAD_EMIT_TIMEOUT_S = 5.0
    STREAM_EMIT_MIN_INTERVAL_S = 0.08
    STREAM_EMIT_MIN_CHARS = 48
    
    def __init__(self):
        self.jobs: Dict[str, PipelineJob] = {}
        self._pipeline_ready = False
        self._app = None
        self._retriever = None
        self._vectorstore = None
        self._categories = []
        self._tracer = None
        self._main_loop = None
        self._node_labels: Dict[str, str] = {
            "guardrail": "Safety Check",
            "dispatcher": "Routing",
            "expander": "Query Expansion",
            "query_plan_hitl": "Query Plan Review",
            "retrieval_hitl": "Citation Review",
            "query_fanout": "Query Fanout",
            "search_worker": "Parallel Search",
            "deduplicator": "Deduplication",
            "grader": "Relevance Grading",
            "web_search_intent_hitl": "Web Search Approval",
            "web_search": "Web Search",
            "hitl_approval": "Web HITL Review",
            "generate": "Answer Generation",
            "code_tester": "Code Testing",
            "critic": "Quality Review",
            "increment_retry": "Retry Planning",
            "summarize": "Summarization",
        }

    def _now_iso(self) -> str:
        return datetime.now().isoformat()

    def _label_for_node(self, node: str) -> str:
        return self._node_labels.get(node, node.replace("_", " ").title())
    
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
            from agent_pipeline import (
                app, 
                build_retriever, 
                get_available_categories,
                set_vectorstore,
                set_query_plan_hitl_handler,
                set_answer_token_stream_handler,
                set_retrieval_hitl_handler,
                set_reasoning_hitl_handler,
                set_blueprint_hitl_handler,
                set_web_hitl_handler,
                set_grader_stream_handler,
                SOURCE_FILES,
                tracer
            )
            
            self._app = app
            
            # Build retriever and vectorstore on-demand
            print("📚 Building vector store...")
            self._retriever, self._vectorstore = build_retriever(SOURCE_FILES, "python")
            self._categories = get_available_categories(self._vectorstore)
            self._tracer = tracer
            
            # CRITICAL: Set the global vectorstore for search_worker_node
            set_vectorstore(self._vectorstore)
            set_query_plan_hitl_handler(self._handle_query_plan_hitl)
            set_answer_token_stream_handler(self._handle_answer_token_stream)
            set_retrieval_hitl_handler(self._handle_retrieval_hitl)
            set_reasoning_hitl_handler(self._handle_reasoning_hitl)
            set_blueprint_hitl_handler(self._handle_blueprint_hitl)
            set_web_hitl_handler(self._handle_web_hitl)
            set_grader_stream_handler(self._handle_grader_stream)
            
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
            hitl_event=threading.Event(),
            query_plan_event=threading.Event()
        )
        self.jobs[job_id] = job
        
        # Start pipeline in background
        asyncio.create_task(self._run_pipeline(job, categories))
        
        return job_id
    
    async def _run_pipeline(self, job: PipelineJob, categories: list = None):
        """Execute the pipeline and emit events."""
        try:
            self._main_loop = asyncio.get_running_loop()
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
                "job_id": job.job_id,
                "available_categories": categories or self._categories,
                "retry_count": 0,
                "revision_count": 0
            }
            
            await self._emit_pipeline_start(job)
            await self._emit_reasoning_chunk(
                job,
                "pipeline",
                f"Analyzing your request: {job.topic}"
            )
            
            # Prefer native async streaming graph execution when available.
            result: Dict[str, Any] = {}
            if self._tracer is not None:
                self._tracer.events = []

            if hasattr(self._app, "astream"):
                seen = 0
                started_nodes: set[str] = set()
                async for chunk in self._app.astream(inputs, {"recursion_limit": 50}):
                    if isinstance(chunk, dict):
                        result.update(chunk)
                    seen = await self._drain_trace_events(job, seen, started_nodes)
                await self._drain_trace_events(job, seen, started_nodes)
            else:
                loop = asyncio.get_event_loop()
                invoke_future = loop.run_in_executor(
                    None,
                    lambda: self._app.invoke(inputs, {"recursion_limit": 50})
                )
                result = await self._poll_trace_until_complete(job, invoke_future)

            if result.get("query_plan_approved") is False:
                job.status = JobStatus.CANCELLED
                reason = result.get("query_plan_rejection_reason") or "Query plan rejected."
                await self._emit_event(job, "cancelled", {"reason": reason})
                return
            if result.get("hitl_approved") is False:
                reason = result.get("hitl_message") or "User rejected approval checkpoint."
                if job.status != JobStatus.CANCELLED:
                    job.status = JobStatus.CANCELLED
                    await self._emit_event(job, "cancelled", {"reason": reason})
                return
            
            # Extract answer
            job.answer = result.get("answer", "No answer generated")
            job.status = JobStatus.COMPLETED
            await self._emit_event(job, "reasoning_done", {"stage": "pipeline", "summary": "Pipeline execution complete."})
            
            await self._emit_event(job, "complete", {"answer": job.answer})
            
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error = str(e)
            await self._emit_event(job, "error", {"error": str(e)})

    def _handle_query_plan_hitl(
        self,
        job_id: str,
        topic: str,
        selected_category: str,
        queries: list
    ) -> Dict[str, Any]:
        """
        Blocking callback invoked by model graph.
        Pauses pipeline until frontend approves/rejects/edits query plan.
        """
        job = self.jobs.get(job_id)
        if not job:
            return {"approved": True, "queries": queries, "reason": "Job not found; auto-approved"}

        job.status = JobStatus.HITL_WAITING
        job.query_plan_data = {
            "job_id": job_id,
            "original_query": topic,
            "query": topic,
            "selected_category": selected_category,
            "queries": queries,
            "can_edit": True,
            "requires_approval": True,
            "message": "Review generated search queries before retrieval."
        }
        if job.query_plan_event is None:
            job.query_plan_event = threading.Event()
        else:
            job.query_plan_event.clear()

        loop = self._main_loop
        if loop is None:
            return {"approved": True, "queries": queries, "reason": "No loop; auto-approved"}
        fut = asyncio.run_coroutine_threadsafe(
            self._emit_event(job, "query_plan_pending", job.query_plan_data),
            loop
        )
        try:
            fut.result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            # Do not deadlock query-plan flow if the SSE push stalls.
            pass

        job.query_plan_event.wait(timeout=self.QUERY_PLAN_WAIT_TIMEOUT_S)

        if job.query_plan_approved:
            edited_queries = job.query_plan_edited_queries or queries
            try:
                asyncio.run_coroutine_threadsafe(
                    self._emit_event(job, "query_plan_approved", {
                        "queries": edited_queries,
                        "edited": edited_queries != queries
                    }),
                    loop
                ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
            except Exception:
                pass
            job.status = JobStatus.RUNNING
            return {"approved": True, "queries": edited_queries, "reason": ""}

        reason = job.query_plan_rejection_reason or "User rejected query plan."
        try:
            asyncio.run_coroutine_threadsafe(
                self._emit_event(job, "query_plan_rejected", {"reason": reason}),
                loop
            ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            pass
        return {"approved": False, "queries": queries, "reason": reason}

    def _handle_answer_token_stream(self, job_id: str, token: str, done: bool = False, final_text: str = ""):
        """Forward streamed answer tokens from model graph to SSE."""
        job = self.jobs.get(job_id)
        loop = self._main_loop
        if not job or loop is None:
            return

        if done:
            if job.answer_stream_buffer:
                buffered = job.answer_stream_buffer
                job.answer_stream_buffer = ""
                job.answer_token_seq += 1
                try:
                    asyncio.run_coroutine_threadsafe(
                        self._emit_event(job, "answer_token", {"token": buffered, "seq": job.answer_token_seq}),
                        loop
                    ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
                except Exception:
                    pass

            token_count = len(final_text.split()) if final_text else 0
            try:
                asyncio.run_coroutine_threadsafe(
                    self._emit_event(job, "answer_done", {"answer": final_text, "token_count": token_count}),
                    loop
                ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
            except Exception:
                pass
            return

        if not token:
            return
        job.answer_stream_buffer += token
        now = time.monotonic()
        should_emit = (
            len(job.answer_stream_buffer) >= self.STREAM_EMIT_MIN_CHARS or
            (job.last_stream_emit_ts == 0.0) or
            (now - job.last_stream_emit_ts >= self.STREAM_EMIT_MIN_INTERVAL_S)
        )
        if not should_emit:
            return

        token_chunk = job.answer_stream_buffer
        job.answer_stream_buffer = ""
        job.last_stream_emit_ts = now
        job.answer_token_seq += 1
        asyncio.run_coroutine_threadsafe(
            self._emit_event(job, "answer_token", {"token": token_chunk, "seq": job.answer_token_seq}),
            loop
        )

    def _handle_grader_stream(
        self,
        job_id: str,
        text: str,
        phase: str = "grading",
        done: bool = False,
        meta: Optional[Dict[str, Any]] = None
    ):
        """Forward sanitized grader rationale chunks to SSE."""
        job = self.jobs.get(job_id)
        loop = self._main_loop
        if not job or loop is None or not text:
            return

        payload: Dict[str, Any] = {
            "phase": phase,
            "text": text,
            "done": bool(done),
        }
        if meta:
            payload["meta"] = meta

        try:
            asyncio.run_coroutine_threadsafe(
                self._emit_event(job, "grader_update", payload),
                loop
            ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            pass

    def _handle_retrieval_hitl(
        self,
        job_id: str,
        topic: str,
        selected_category: str,
        citations: list
    ) -> Dict[str, Any]:
        """Blocking callback for post-grader retrieval citation approval."""
        job = self.jobs.get(job_id)
        if not job:
            return {"approved": True, "reason": "Job not found; auto-approved"}

        job.status = JobStatus.HITL_WAITING
        job.hitl_edited_text = None
        job.hitl_data = {
            "hitl_type": "retrieval_review",
            "job_id": job_id,
            "query": topic,
            "selected_category": selected_category,
            "results": citations,
            "search_results": citations,
            "total_results_found": len(citations),
            "results_shown": len(citations),
            "search_depth": "local_rag",
            "search_latency_ms": 0.0,
            "reason": "Relevant local citations were found. Approve them before generation.",
            "message": "Review retrieved citations before answer generation."
        }
        if job.hitl_event is None:
            job.hitl_event = threading.Event()
        else:
            job.hitl_event.clear()

        loop = self._main_loop
        if loop is None:
            return {"approved": True, "reason": "No loop; auto-approved"}

        try:
            asyncio.run_coroutine_threadsafe(
                self._emit_event(job, "hitl_pending", job.hitl_data),
                loop
            ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            pass

        job.hitl_event.wait(timeout=self.QUERY_PLAN_WAIT_TIMEOUT_S)

        if job.hitl_approved:
            job.status = JobStatus.RUNNING
            return {"approved": True, "reason": ""}

        reason = job.hitl_rejection_reason or "User rejected retrieval citations."
        return {"approved": False, "reason": reason}

    def _handle_web_hitl(
        self,
        job_id: str,
        topic: str,
        selected_category: str,
        phase: str = "pre_web_search",
        results: Optional[list] = None,
        ai_summary: str = ""
    ) -> Dict[str, Any]:
        """Blocking callback for web-search HITL checkpoints."""
        job = self.jobs.get(job_id)
        if not job:
            return {"approved": True, "reason": "Job not found; auto-approved"}

        normalized_results = results or []
        is_pre_search = phase == "pre_web_search"

        job.status = JobStatus.HITL_WAITING
        job.hitl_edited_text = None
        job.hitl_data = {
            "hitl_type": "pre_web_search_review" if is_pre_search else "web_search_review",
            "job_id": job_id,
            "query": topic,
            "ai_answer": ai_summary if not is_pre_search else "",
            "selected_category": selected_category,
            "results": normalized_results,
            "search_results": normalized_results,
            "total_results_found": len(normalized_results),
            "results_shown": len(normalized_results),
            "search_depth": "pre_web_search" if is_pre_search else "basic",
            "search_latency_ms": 0.0,
            "reason": (
                "Local retrieval exhausted after retries. "
                "Approve to run web search."
                if is_pre_search
                else "Web search completed. Review results before generation."
            ),
            "message": (
                "Approve web search before execution."
                if is_pre_search
                else "Review web search results before generation."
            )
        }
        if job.hitl_event is None:
            job.hitl_event = threading.Event()
        else:
            job.hitl_event.clear()

        loop = self._main_loop
        if loop is None:
            return {"approved": True, "reason": "No loop; auto-approved"}

        try:
            asyncio.run_coroutine_threadsafe(
                self._emit_event(job, "hitl_pending", job.hitl_data),
                loop
            ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            pass

        job.hitl_event.wait(timeout=self.QUERY_PLAN_WAIT_TIMEOUT_S)

        if job.hitl_approved:
            job.status = JobStatus.RUNNING
            return {"approved": True, "reason": ""}

        reason = job.hitl_rejection_reason or (
            "User rejected web search execution."
            if is_pre_search
            else "User rejected web search results."
        )
        return {"approved": False, "reason": reason}

    def _handle_reasoning_hitl(
        self,
        job_id: str,
        topic: str,
        selected_category: str,
        reasoning_text: str,
        editable_text: str = "",
        search_results: Optional[list] = None,
    ) -> Dict[str, Any]:
        """Blocking callback for post-reasoning review before full draft generation."""
        job = self.jobs.get(job_id)
        if not job:
            return {"approved": True, "reason": "Job not found; auto-approved", "edited_text": ""}

        normalized_results = search_results or []
        summary_preview = (reasoning_text or "").strip()[:1800]
        editable_preview = (editable_text or reasoning_text or "").strip()[:4000]

        job.status = JobStatus.HITL_WAITING
        job.hitl_edited_text = None
        job.hitl_data = {
            "hitl_type": "reasoning_review",
            "job_id": job_id,
            "query": topic,
            "ai_answer": summary_preview,
            "reasoning_text": (reasoning_text or "").strip()[:12000],
            "editable_text": editable_preview,
            "selected_category": selected_category,
            "results": normalized_results,
            "search_results": normalized_results,
            "total_results_found": len(normalized_results),
            "results_shown": len(normalized_results),
            "search_depth": "reasoning",
            "search_latency_ms": 0.0,
            "reason": "Reasoning phase completed. Review before full draft generation.",
            "message": "Review model reasoning. Accept, reject, or edit before draft generation.",
        }
        if job.hitl_event is None:
            job.hitl_event = threading.Event()
        else:
            job.hitl_event.clear()

        loop = self._main_loop
        if loop is None:
            return {"approved": True, "reason": "No loop; auto-approved", "edited_text": ""}

        try:
            asyncio.run_coroutine_threadsafe(
                self._emit_event(job, "hitl_pending", job.hitl_data),
                loop
            ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            pass

        job.hitl_event.wait(timeout=self.QUERY_PLAN_WAIT_TIMEOUT_S)

        if job.hitl_approved:
            job.status = JobStatus.RUNNING
            return {
                "approved": True,
                "reason": "",
                "edited_text": job.hitl_edited_text or "",
            }

        reason = job.hitl_rejection_reason or "User rejected reasoning review."
        return {"approved": False, "reason": reason, "edited_text": ""}

    def _handle_blueprint_hitl(
        self,
        job_id: str,
        topic: str,
        selected_category: str,
        reasoning_text: str,
        blueprint_text: str = "",
        editable_text: str = "",
    ) -> Dict[str, Any]:
        """Blocking callback for post-blueprint review before full draft generation."""
        job = self.jobs.get(job_id)
        if not job:
            return {"approved": True, "reason": "Job not found; auto-approved", "edited_text": ""}

        blueprint_preview = (blueprint_text or "").strip()[:12000]
        editable_preview = (editable_text or blueprint_text or "").strip()[:12000]

        job.status = JobStatus.HITL_WAITING
        job.hitl_edited_text = None
        job.hitl_data = {
            "hitl_type": "blueprint_review",
            "job_id": job_id,
            "query": topic,
            "reasoning_text": (reasoning_text or "").strip()[:6000],
            "blueprint_text": blueprint_preview,
            "editable_text": editable_preview,
            "selected_category": selected_category,
            "results": [],
            "search_results": [],
            "total_results_found": 0,
            "results_shown": 0,
            "search_depth": "blueprint",
            "search_latency_ms": 0.0,
            "reason": "Blueprint generated. Review structure before full article generation.",
            "message": "Review the blueprint. Accept, reject, or edit before article generation.",
        }
        if job.hitl_event is None:
            job.hitl_event = threading.Event()
        else:
            job.hitl_event.clear()

        loop = self._main_loop
        if loop is None:
            return {"approved": True, "reason": "No loop; auto-approved", "edited_text": ""}

        try:
            asyncio.run_coroutine_threadsafe(
                self._emit_event(job, "hitl_pending", job.hitl_data),
                loop
            ).result(timeout=self.THREAD_EMIT_TIMEOUT_S)
        except Exception:
            pass

        job.hitl_event.wait(timeout=self.QUERY_PLAN_WAIT_TIMEOUT_S)

        if job.hitl_approved:
            job.status = JobStatus.RUNNING
            return {
                "approved": True,
                "reason": "",
                "edited_text": job.hitl_edited_text or "",
            }

        reason = job.hitl_rejection_reason or "User rejected blueprint review."
        return {"approved": False, "reason": reason, "edited_text": ""}

    async def _run_llm_job(self, job: PipelineJob):
        """Run a lightweight LLM-only response (no retrieval)."""
        await self._emit_pipeline_start(job)
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
        await self._emit_pipeline_start(job)
        await self._emit_node_start(job, "web_search")
        
        # Track timing for transparency
        search_start = time.time()
        
        search_agent = WebSearchAgent()
        search_response = search_agent.search(job.topic, expand=False)
        
        search_latency_ms = (time.time() - search_start) * 1000
        
        raw_results = search_response.get("results", [])
        ai_summary = search_response.get("answer")
        
        await self._emit_node_end(job, "web_search", search_latency_ms, {"results_count": len(raw_results)})
        
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
            await self._emit_node_start(job, "summarize")
            
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
            
            await self._emit_node_end(job, "summarize", 0.0)
        
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
        job.event_seq += 1
        event = {
            "event": event_type,
            "timestamp": self._now_iso(),
            "seq": job.event_seq,
            "data": data
        }
        job.trace.append(event)
        await job.event_queue.put(event)

    async def _emit_pipeline_start(self, job: PipelineJob):
        await self._emit_event(job, "pipeline_start", {
            "job_id": job.job_id,
            "topic": job.topic,
            "mode": job.mode,
            "started_at": self._now_iso(),
        })

    async def _emit_node_start(self, job: PipelineJob, node: str, attempt: int = 1):
        await self._emit_event(job, "node_start", {
            "node": node,
            "label": self._label_for_node(node),
            "attempt": attempt,
            "ts": self._now_iso(),
        })

    async def _emit_node_end(self, job: PipelineJob, node: str, latency_ms: float, meta: Optional[Dict[str, Any]] = None):
        payload: Dict[str, Any] = {
            "node": node,
            "label": self._label_for_node(node),
            "latency_ms": latency_ms,
            "ts": self._now_iso(),
        }
        if meta:
            payload["meta"] = meta
        await self._emit_event(job, "node_end", payload)

    async def _emit_reasoning_chunk(self, job: PipelineJob, stage: str, text: str):
        """Emit a single semantic reasoning log line."""
        job.reasoning_seq += 1
        await self._emit_event(job, "reasoning_chunk", {
            "stage": stage,
            "text": text,
            "seq": job.reasoning_seq
        })

    async def _poll_trace_until_complete(self, job: PipelineJob, invoke_future):
        """Poll model trace events while pipeline executes in a background thread."""
        if self._tracer is None:
            return await invoke_future

        seen = 0
        started_nodes = set()

        while not invoke_future.done():
            seen = await self._drain_trace_events(job, seen, started_nodes)
            await asyncio.sleep(0.1)

        seen = await self._drain_trace_events(job, seen, started_nodes)
        return await invoke_future

    async def _drain_trace_events(self, job: PipelineJob, seen: int, started_nodes: set) -> int:
        """Convert trace logger events into SSE node and reasoning events."""
        if self._tracer is None:
            return seen

        while seen < len(self._tracer.events):
            trace_event = self._tracer.events[seen]
            seen += 1

            raw_node = str(trace_event.get("node", "unknown"))
            node = raw_node.replace("_node", "")
            latency_s = float(trace_event.get("latency", 0.0) or 0.0)
            payload = str(trace_event.get("payload", ""))

            if node not in started_nodes:
                started_nodes.add(node)
                await self._emit_node_start(job, node, attempt=1)

            await self._emit_node_end(job, node, round(latency_s * 1000, 2))

            reasoning_text = self._reasoning_text_for_node(node, payload)
            if reasoning_text:
                await self._emit_reasoning_chunk(job, node, reasoning_text)

        return seen

    def _reasoning_text_for_node(self, node: str, payload: str) -> str:
        """Map node outputs to concise semantic reasoning logs."""
        if node == "guardrail":
            return "Safety checks completed. Query is allowed."
        if node == "dispatcher":
            return "Routing the query to the most relevant knowledge domain."
        if node == "expand_query":
            return "Generating multiple query variants for parallel retrieval."
        if node == "query_plan_hitl":
            return "Waiting for your approval on generated search queries."
        if node == "retrieval_hitl":
            return "Waiting for your approval on retrieved citations."
        if node == "search_worker":
            return "Running parallel searches across query variants."
        if node == "deduplicate":
            return "Merging overlapping retrieval results and removing duplicates."
        if node == "grade_documents":
            return "Evaluating retrieved content for relevance to your question."
        if node == "increment_retry":
            return "Low relevance detected. Broadening the search scope for another pass."
        if node == "generate_answer":
            return "Drafting the response from validated context."
        if node == "code_tester":
            return "Verifying generated code snippets for execution safety."
        if node == "critic":
            return "Reviewing the draft for quality and completeness."
        if node == "web_search":
            return "Local context was insufficient. Performing web search fallback."
        if node == "hitl_approval":
            return "Waiting for user review before continuing expensive generation."
        if "out_of_domain" in payload:
            return "The query appears outside the current knowledge domains."
        return ""
    
    async def stream_events(self, job_id: str, last_seq: int = 0) -> AsyncGenerator[dict, None]:
        """
        Async generator that yields events for SSE streaming.
        """
        job = self.jobs.get(job_id)
        if not job:
            yield {"event": "error", "data": {"error": "Job not found"}}
            return

        if last_seq > 0:
            for event in job.trace:
                if int(event.get("seq", 0)) > last_seq:
                    yield event
        
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
                if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
                    break
                # Send keepalive while job is still active.
                yield {"event": "keepalive", "data": {}}
    
    def get_job(self, job_id: str) -> Optional[PipelineJob]:
        """Get job by ID."""
        return self.jobs.get(job_id)
    
    async def approve_hitl(self, job_id: str, feedback: str = None, edited_text: str = None) -> bool:
        """Approve HITL checkpoint and continue pipeline."""
        job = self.jobs.get(job_id)
        if not job or job.status != JobStatus.HITL_WAITING:
            return False
        if not job.hitl_data:
            return False
        
        job.hitl_approved = True
        job.hitl_rejection_reason = None
        job.hitl_edited_text = str(edited_text).strip() if edited_text else None
        job.status = JobStatus.RUNNING
        job.hitl_event.set()  # Unblock pipeline
        await self._emit_event(job, "hitl_approved", {
            "feedback": feedback,
            "edited_text": job.hitl_edited_text,
        })
        return True

    async def approve_query_plan(self, job_id: str, edited_queries: list = None, feedback: str = None) -> bool:
        """Approve query-plan HITL checkpoint and continue pipeline."""
        job = self.jobs.get(job_id)
        if not job or job.status != JobStatus.HITL_WAITING:
            return False
        if not job.query_plan_data:
            return False

        job.query_plan_approved = True
        job.query_plan_edited_queries = edited_queries or job.query_plan_data.get("queries", [])
        if feedback:
            job.query_plan_rejection_reason = feedback
        if job.query_plan_event:
            job.query_plan_event.set()
        return True

    async def reject_query_plan(self, job_id: str, reason: str = None) -> bool:
        """Reject query-plan HITL checkpoint and stop this pipeline run."""
        job = self.jobs.get(job_id)
        if not job or job.status != JobStatus.HITL_WAITING:
            return False
        if not job.query_plan_data:
            return False

        job.query_plan_approved = False
        job.query_plan_rejection_reason = reason or "User rejected query plan."
        if job.query_plan_event:
            job.query_plan_event.set()
        return True
    
    async def reject_hitl(self, job_id: str, reason: str = None) -> bool:
        """Reject HITL checkpoint and cancel pipeline."""
        job = self.jobs.get(job_id)
        if not job or job.status != JobStatus.HITL_WAITING:
            return False
        if not job.hitl_data:
            return False
        
        job.hitl_approved = False
        job.hitl_rejection_reason = reason or "User rejected"
        job.hitl_edited_text = None
        job.status = JobStatus.CANCELLED
        job.hitl_event.set()
        await self._emit_event(job, "cancelled", {"reason": reason or "User rejected"})
        return True

    async def cancel_job(self, job_id: str, reason: str = "Cancelled by user") -> bool:
        """Cancel an active job and notify subscribers."""
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            return False
        job.status = JobStatus.CANCELLED
        await self._emit_event(job, "cancelled", {"reason": reason})
        return True

    async def resume_job(self, job_id: str) -> bool:
        """
        Resume streaming for an in-flight job.
        This does not restart computation; it marks status back to running when possible.
        """
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            return False
        job.status = JobStatus.RUNNING
        await self._emit_event(job, "status_change", {"status": "running"})
        return True


# Global runner instance
runner = PipelineRunner()

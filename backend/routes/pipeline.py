"""
Pipeline Routes - /pipeline/* endpoints
"""
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse
import json

from ..schemas import (
    PipelineRunRequest,
    PipelineRunResponse,
    PipelineResultResponse,
    IntentRequest,
    IntentResponse,
    JobStatus
)
from ..db import CategoryRepository, ResourceRepository
from ..pipeline_runner import runner
from langchain_ollama import ChatOllama

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])
category_repo = CategoryRepository()
resource_repo = ResourceRepository()


@router.post("/run", response_model=PipelineRunResponse)
async def run_pipeline(request: PipelineRunRequest):
    """
    Start a new pipeline job.
    Returns immediately with job_id for tracking.
    """
    try:
        job_id = await runner.start_job(
            topic=request.topic,
            categories=request.categories,
            mode=request.mode.value
        )
        
        return PipelineRunResponse(
            job_id=job_id,
            status=JobStatus.RUNNING,
            message=f"Pipeline started for: {request.topic}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _summarize_resources():
    """Get actual document counts and sample titles from vectorstore."""
    from ..content_manager import get_vectorstore
    
    try:
        vectorstore = get_vectorstore()
        all_docs = vectorstore.get(include=['metadatas'])
        metadatas = all_docs.get('metadatas', [])
        
        # Count documents per category and collect unique sources
        category_counts = {}
        sources = set()
        for meta in metadatas:
            if meta:
                if 'category' in meta:
                    cat = meta['category']
                    category_counts[cat] = category_counts.get(cat, 0) + 1
                # Collect document titles/sources
                source = meta.get('source') or meta.get('title') or meta.get('filename')
                if source:
                    # Clean up source path to just filename
                    import os
                    sources.add(os.path.basename(str(source)))
        
        total_docs = len(metadatas)
        categories = list(category_counts.keys())
        
        # Build category summary string
        if category_counts:
            cat_summary = ", ".join(
                f"{count} in {name}" for name, count in sorted(category_counts.items(), key=lambda x: -x[1])
            )
        else:
            cat_summary = "no documents yet"
        
        # Get sample document names (up to 5)
        sample_docs = list(sources)[:5]
        doc_examples = ", ".join(sample_docs) if sample_docs else ""
        
        return {
            "category_count": len(categories),
            "resource_count": total_docs,
            "categories": categories,
            "category_counts": category_counts,
            "category_summary": cat_summary,
            "sample_docs": sample_docs,
            "doc_examples": doc_examples,
        }
    except Exception:
        return {
            "category_count": 0,
            "resource_count": 0,
            "categories": [],
            "category_counts": {},
            "category_summary": "no documents yet",
            "sample_docs": [],
            "doc_examples": "",
        }


def _classify_intent(query: str, resource_count: int = 0, category_summary: str = "", doc_examples: str = "") -> dict:
    """Use LLM to classify intent and generate dynamic responses."""
    normalized = (query or "").strip()
    if not normalized or len(normalized) <= 2:
        return {
            "action": "clarify",
            "message": "Could you tell me a bit more? I'm here to help!",
            "examples": [
                "Explain Python decorators",
                "What are list comprehensions?",
                "Help me understand async/await",
            ],
        }
    
    # Use LLM for intent classification
    llm = ChatOllama(model="gpt-oss:120b-cloud", temperature=0.7, num_ctx=64000)
    
    classification_prompt = f"""Classify this user message into exactly ONE category:
- GREETING: greetings, introductions, "who are you", "what can you do", "tell me about yourself", "help"
- KNOWLEDGE: questions about programming, Python, technical topics, requests for explanations
- UNCLEAR: gibberish, typos, nonsensical, too vague to understand

User message: "{normalized}"

Respond with ONLY the category name (GREETING, KNOWLEDGE, or UNCLEAR), nothing else."""

    try:
        classification = llm.invoke(classification_prompt).content.strip().upper()
    except Exception:
        classification = "KNOWLEDGE"
    
    # Clean up classification 
    for cat in ["GREETING", "KNOWLEDGE", "UNCLEAR"]:
        if cat in classification:
            classification = cat
            break
    else:
        classification = "KNOWLEDGE"
    
    if classification == "GREETING":
        # Build knowledge base description with document examples
        if resource_count > 0:
            kb_desc = f"{resource_count} documents ({category_summary})"
            if doc_examples:
                kb_desc += f" including topics like {doc_examples}"
        else:
            kb_desc = "your knowledge base (empty for now)"
        
        greeting_prompt = f"""You are Octo, a friendly knowledge assistant. The user said: "{normalized}"
Respond warmly in 2-3 sentences. Mention you can search {kb_desc}, answer from your built-in knowledge, or search the web. End with an invitation to ask a question. No bullet points. No thinking tags."""

        try:
            response = llm.invoke(greeting_prompt).content.strip()
            if "<think>" in response:
                response = response.split("</think>")[-1].strip()
        except Exception:
            response = f"Hi! I'm Octo. I can search {kb_desc}, answer from my knowledge, or search the web. What would you like to know?"
        
        return {
            "action": "greeting",
            "message": response,
            "examples": [
                "Explain Python decorators",
                "What are generators?",
                "Find Python 3.12 features",
            ],
        }
    
    if classification == "UNCLEAR":
        return {
            "action": "clarify", 
            "message": "I'm not quite sure what you mean. Could you rephrase that?",
            "examples": [
                "Explain Python decorators",
                "What are list comprehensions?",
                "How does async/await work?",
            ],
        }
    
    return {
        "action": "choose_source",
        "message": "",
        "examples": [],
    }


@router.post("/intent", response_model=IntentResponse)
async def classify_intent(payload: IntentRequest):
    """Classify user intent before running the pipeline."""
    summary = _summarize_resources()
    intent = _classify_intent(payload.query, summary["resource_count"], summary["category_summary"], summary["doc_examples"])
    return IntentResponse(
        action=intent["action"],
        message=intent["message"],
        examples=intent["examples"],
        resource_count=summary["resource_count"],
        category_count=summary["category_count"],
        categories=summary["categories"],
    )


@router.get("/status/{job_id}")
async def stream_status(job_id: str):
    """
    SSE endpoint for real-time pipeline status updates.
    Connect to this to receive events as pipeline progresses.
    """
    job = runner.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    async def event_generator():
        async for event in runner.stream_events(job_id):
            yield {
                "event": event.get("event", "message"),
                "data": json.dumps(event.get("data", {}))
            }
    
    return EventSourceResponse(event_generator())


@router.get("/result/{job_id}", response_model=PipelineResultResponse)
async def get_result(job_id: str):
    """
    Get the final result of a completed pipeline job.
    """
    job = runner.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return PipelineResultResponse(
        job_id=job.job_id,
        status=job.status,
        topic=job.topic,
        answer=job.answer,
        error=job.error,
        trace=job.trace
    )


@router.get("/jobs")
async def list_jobs():
    """List all jobs (for debugging)."""
    return {
        job_id: {
            "topic": job.topic,
            "status": job.status.value,
            "created_at": job.created_at.isoformat()
        }
        for job_id, job in runner.jobs.items()
    }

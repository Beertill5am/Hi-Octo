"""
HITL Routes - /hitl/* endpoints
Human-in-the-Loop approval/rejection for web search results.
Full transparency: scores, domains, latency, and reasons displayed.
"""
from fastapi import APIRouter, HTTPException

from ..schemas import HITLDecision, HITLPendingData, EnhancedSearchResult, JobStatus
from ..pipeline_runner import runner

router = APIRouter(prefix="/hitl", tags=["HITL"])


@router.get("/pending/{job_id}", response_model=HITLPendingData)
async def get_pending_hitl(job_id: str):
    """
    Get HITL checkpoint data for a job waiting for approval.
    Returns enhanced search results with full transparency metadata.
    """
    job = runner.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != JobStatus.HITL_WAITING:
        raise HTTPException(
            status_code=400, 
            detail=f"Job is not waiting for HITL approval. Status: {job.status.value}"
        )
    
    hitl_data = job.hitl_data or {}
    
    # Convert to enhanced schema with full metadata.
    # Accept both legacy "results" and normalized "search_results".
    search_results = []
    raw_results = hitl_data.get("search_results") or hitl_data.get("results", [])
    for result in raw_results:
        if isinstance(result, dict):
            search_results.append(EnhancedSearchResult(
                title=result.get("title", "Untitled"),
                url=result.get("url", ""),
                snippet=result.get("snippet", ""),
                full_content=result.get("full_content"),
                relevance_score=result.get("relevance_score", 0.0),
                domain=result.get("domain", ""),
                word_count=result.get("word_count", 0),
                retrieved_at=result.get("retrieved_at", ""),
                source_id=result.get("source_id"),
                citation=result.get("citation"),
                page=result.get("page")
            ))
    
    hitl_type = hitl_data.get("hitl_type", "web_search_review")
    return HITLPendingData(
        job_id=job_id,
        hitl_type=hitl_type,
        query=job.topic,
        ai_summary=hitl_data.get("ai_answer"),
        search_results=search_results,
        total_results_found=hitl_data.get("total_results_found", len(search_results)),
        results_shown=len(search_results),
        search_depth=hitl_data.get("search_depth", "basic"),
        search_latency_ms=hitl_data.get("search_latency_ms", 0.0),
        reason_for_web_search=hitl_data.get("reason", ""),
        requires_approval=True,
        message=hitl_data.get(
            "message",
            "Review retrieved citations before generation"
            if hitl_type == "retrieval_review"
            else "Approve web search before execution"
            if hitl_type == "pre_web_search_review"
            else "Review these web search results before generation"
        )
    )


@router.post("/approve/{job_id}")
async def approve_hitl(job_id: str, decision: HITLDecision = None):
    """
    Approve HITL checkpoint and continue pipeline.
    """
    feedback = decision.feedback if decision else None
    
    success = await runner.approve_hitl(job_id, feedback)
    if not success:
        job = runner.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve job with status: {job.status.value}"
        )
    
    return {
        "job_id": job_id,
        "status": "approved",
        "message": "Pipeline will continue with generation"
    }


@router.post("/reject/{job_id}")
async def reject_hitl(job_id: str, decision: HITLDecision = None):
    """
    Reject HITL checkpoint and cancel pipeline.
    """
    reason = decision.feedback if decision else "User rejected"
    
    success = await runner.reject_hitl(job_id, reason)
    if not success:
        job = runner.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject job with status: {job.status.value}"
        )
    
    return {
        "job_id": job_id,
        "status": "rejected",
        "message": "Pipeline cancelled"
    }

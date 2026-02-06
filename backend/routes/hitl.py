"""
HITL Routes - /hitl/* endpoints
Human-in-the-Loop approval/rejection for web search results.
"""
from fastapi import APIRouter, HTTPException

from ..schemas import HITLDecision, HITLPendingData, SearchResultItem, JobStatus
from ..pipeline_runner import runner

router = APIRouter(prefix="/hitl", tags=["HITL"])


@router.get("/pending/{job_id}", response_model=HITLPendingData)
async def get_pending_hitl(job_id: str):
    """
    Get HITL checkpoint data for a job waiting for approval.
    Returns search results and context for user decision.
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
    
    # Convert raw results to schema
    search_results = []
    for result in hitl_data.get("results", []):
        if isinstance(result, dict):
            search_results.append(SearchResultItem(
                title=result.get("title", "No title"),
                url=result.get("url", ""),
                snippet=result.get("content", result.get("snippet", ""))[:200]
            ))
    
    return HITLPendingData(
        job_id=job_id,
        query=job.topic,
        ai_summary=hitl_data.get("ai_answer"),
        search_results=search_results[:5],
        message="Review these web search results before generation"
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

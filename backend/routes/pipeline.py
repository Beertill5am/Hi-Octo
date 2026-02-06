"""
Pipeline Routes - /pipeline/* endpoints
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
import json

from ..schemas import (
    PipelineRunRequest,
    PipelineRunResponse,
    PipelineResultResponse,
    JobStatus
)
from ..pipeline_runner import runner

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])


@router.post("/run", response_model=PipelineRunResponse)
async def run_pipeline(request: PipelineRunRequest):
    """
    Start a new pipeline job.
    Returns immediately with job_id for tracking.
    """
    try:
        job_id = await runner.start_job(
            topic=request.topic,
            categories=request.categories
        )
        
        return PipelineRunResponse(
            job_id=job_id,
            status=JobStatus.RUNNING,
            message=f"Pipeline started for: {request.topic}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

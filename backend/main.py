"""
FastAPI Backend for Agentic RAG Pipeline
=========================================

Run with: uvicorn backend.main:app --reload

Endpoints:
- POST /pipeline/run      - Start a query
- GET  /pipeline/status/{id} - SSE stream of events
- GET  /pipeline/result/{id} - Get final result
- GET  /hitl/pending/{id} - Get HITL checkpoint data
- POST /hitl/approve/{id} - Continue pipeline
- POST /hitl/reject/{id}  - Cancel pipeline
"""
import sys
import os

# Add parent directory to path for pipeline imports
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

# Load project-root .env (REMOTION_RENDER_ENDPOINT, etc.)
from dotenv import load_dotenv
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import pipeline, hitl
from .routes import content, categories
from .db import init_db

# ═══════════════════════════════════════════════════════════════════════════════
# APP CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Agentic RAG API",
    description="API for the Agentic RAG Pipeline with HITL support",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

app.include_router(pipeline.router)
app.include_router(hitl.router)
app.include_router(content.router)
app.include_router(categories.router)


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT & HEALTH
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {
        "name": "Agentic RAG API",
        "version": "0.1.0",
        "docs": "/docs",
        "endpoints": {
            "pipeline": "/pipeline/run, /pipeline/status/{id}, /pipeline/result/{id}",
            "hitl": "/hitl/pending/{id}, /hitl/approve/{id}, /hitl/reject/{id}"
        }
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


# ═══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════════════════════

@app.on_event("startup")
async def startup():
    init_db()
    print("🚀 Agentic RAG API starting...")
    print("📚 Pipeline will be initialized on first request")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

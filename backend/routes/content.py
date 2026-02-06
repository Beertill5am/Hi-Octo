"""
Content Routes - /content endpoints
"""
import os
import uuid
from datetime import datetime
from html.parser import HTMLParser
from typing import Optional
from urllib.request import urlopen

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..content_manager import (
    add_documents,
    calculate_file_hash,
    delete_documents_by_resource,
    write_web_resource_file,
)
from ..db import CategoryRepository, ResourceRepository
from ..indexer import index_file
from ..schemas import ResourceResponse, ResourceUpdateRequest, WebImportRequest

router = APIRouter(prefix="/content", tags=["Content"])
resource_repo = ResourceRepository()
category_repo = CategoryRepository()

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._chunks = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self._chunks.append(data.strip())

    def get_text(self) -> str:
        return "\n".join(self._chunks)


def _fetch_url_text(url: str) -> str:
    with urlopen(url) as response:
        html = response.read().decode("utf-8", errors="ignore")
    parser = _TextExtractor()
    parser.feed(html)
    return parser.get_text()


@router.get("", response_model=list[ResourceResponse])
async def list_resources(category: Optional[str] = None, status: Optional[str] = None):
    resources = resource_repo.list(category=category, status=status)
    return [resource.to_dict() for resource in resources]


@router.get("/{resource_id}", response_model=ResourceResponse)
async def get_resource(resource_id: str):
    resource = resource_repo.get(resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    return resource.to_dict()


@router.post("/upload", response_model=ResourceResponse)
async def upload_resource(
    file: UploadFile = File(...),
    category: str = Form(...),
    title: Optional[str] = Form(None),
    author: Optional[str] = Form(None),
    published_date: Optional[str] = Form(None),
    source_url: Optional[str] = Form(None),
    subject: Optional[str] = Form(None),
    topic: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    resource_id = f"res_{uuid.uuid4().hex[:10]}"
    filename = f"{resource_id}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    content = await file.read()
    with open(file_path, "wb") as handle:
        handle.write(content)

    file_hash = calculate_file_hash(file_path)
    category_repo.ensure(category)
    resource = resource_repo.create(
        {
            "id": resource_id,
            "filename": filename,
            "original_name": file.filename,
            "category": category,
            "source_type": "upload",
            "title": title,
            "author": author,
            "published_date": published_date,
            "source_url": source_url,
            "subject": subject,
            "topic": topic,
            "tags": tags.split(",") if tags else [],
            "file_path": file_path,
            "file_size": len(content),
            "file_hash": file_hash,
            "chunk_count": 0,
            "status": "processing",
        }
    )

    try:
        documents, _analysis = index_file(file_path)
        chunk_count = add_documents(
            documents,
            category=category,
            resource_metadata={
                "resource_id": resource_id,
                "source": file.filename,
                "source_url": source_url,
                "title": title,
                "author": author,
                "published_date": published_date,
                "subject": subject,
                "topic": topic,
                "tags": tags,
                "file_hash": file_hash,
            },
        )
        updated = resource_repo.update(
            resource_id,
            {"chunk_count": chunk_count, "status": "active", "updated_at": datetime.now().isoformat()},
        )
        category_repo.refresh_counts()
        return updated.to_dict() if updated else resource.to_dict()
    except Exception as e:
        resource_repo.update(resource_id, {"status": "failed", "updated_at": datetime.now().isoformat()})
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")


@router.post("/web-import", response_model=ResourceResponse)
async def import_web_resource(payload: WebImportRequest):
    resource_id = f"res_{uuid.uuid4().hex[:10]}"
    text = _fetch_url_text(payload.url)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Failed to extract content from URL")

    metadata = {
        "title": payload.title or payload.url,
        "author": payload.author,
        "source_url": payload.url,
        "published_date": payload.published_date,
        "subject": payload.subject,
        "topic": payload.topic,
    }
    file_path = write_web_resource_file(UPLOAD_DIR, resource_id, text, metadata)
    file_hash = calculate_file_hash(file_path)

    category_repo.ensure(payload.category)
    resource = resource_repo.create(
        {
            "id": resource_id,
            "filename": os.path.basename(file_path),
            "original_name": None,
            "category": payload.category,
            "source_type": "web_scrape",
            "title": payload.title,
            "author": payload.author,
            "published_date": payload.published_date,
            "source_url": payload.url,
            "subject": payload.subject,
            "topic": payload.topic,
            "tags": payload.tags or [],
            "file_path": file_path,
            "file_size": os.path.getsize(file_path),
            "file_hash": file_hash,
            "chunk_count": 0,
            "status": "processing",
        }
    )

    try:
        documents, _analysis = index_file(file_path)
        chunk_count = add_documents(
            documents,
            category=payload.category,
            resource_metadata={
                "resource_id": resource_id,
                "source": payload.url,
                "source_url": payload.url,
                "title": payload.title,
                "author": payload.author,
                "published_date": payload.published_date,
                "subject": payload.subject,
                "topic": payload.topic,
                "tags": payload.tags,
                "file_hash": file_hash,
            },
        )
        updated = resource_repo.update(
            resource_id,
            {"chunk_count": chunk_count, "status": "active", "updated_at": datetime.now().isoformat()},
        )
        category_repo.refresh_counts()
        return updated.to_dict() if updated else resource.to_dict()
    except Exception as e:
        resource_repo.update(resource_id, {"status": "failed", "updated_at": datetime.now().isoformat()})
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")


@router.patch("/{resource_id}", response_model=ResourceResponse)
async def update_resource(resource_id: str, payload: ResourceUpdateRequest):
    updated = resource_repo.update(resource_id, payload.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Resource not found")
    return updated.to_dict()


@router.delete("/{resource_id}")
async def delete_resource(resource_id: str):
    resource = resource_repo.get(resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    resource_repo.soft_delete(resource_id)
    delete_documents_by_resource(resource_id)
    category_repo.refresh_counts()
    return {"status": "deleted", "id": resource_id}


@router.post("/{resource_id}/reindex", response_model=ResourceResponse)
async def reindex_resource(resource_id: str):
    resource = resource_repo.get(resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    if not resource.file_path or not os.path.exists(resource.file_path):
        raise HTTPException(status_code=400, detail="Resource file missing on disk")

    delete_documents_by_resource(resource_id)
    documents, _analysis = index_file(resource.file_path)
    chunk_count = add_documents(
        documents,
        category=resource.category,
        resource_metadata={
            "resource_id": resource.id,
            "source": resource.source_url or resource.filename,
            "source_url": resource.source_url,
            "title": resource.title,
            "author": resource.author,
            "published_date": resource.published_date,
            "subject": resource.subject,
            "topic": resource.topic,
            "tags": resource.tags,
            "file_hash": resource.file_hash,
        },
    )
    updated = resource_repo.update(
        resource_id,
        {"chunk_count": chunk_count, "status": "active", "updated_at": datetime.now().isoformat()},
    )
    category_repo.refresh_counts()
    return updated.to_dict()

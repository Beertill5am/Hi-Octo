"""
Category Routes - /categories endpoints
"""
from fastapi import APIRouter, HTTPException

from ..content_manager import list_vectorstore_categories, delete_documents_by_category
from ..db import CategoryRepository, ResourceRepository
from ..schemas import CategoryCreateRequest, CategoryResponse

router = APIRouter(prefix="/categories", tags=["Categories"])
category_repo = CategoryRepository()
resource_repo = ResourceRepository()


@router.get("", response_model=list[CategoryResponse])
async def list_categories():
    """List categories from DB and vectorstore with document counts."""
    from ..content_manager import get_vectorstore
    
    # Get categories from vectorstore
    vector_categories = list_vectorstore_categories()
    
    # Get document counts per category from vectorstore
    vectorstore = get_vectorstore()
    category_counts = {}
    try:
        all_docs = vectorstore.get(include=['metadatas'])
        for meta in all_docs.get('metadatas', []):
            if meta and 'category' in meta:
                cat = meta['category']
                category_counts[cat] = category_counts.get(cat, 0) + 1
    except Exception:
        pass
    
    # Merge with DB categories
    db_categories = {item["name"]: item for item in category_repo.list()}
    
    result = []
    for name in set(vector_categories) | set(db_categories.keys()):
        if name not in db_categories:
            category_repo.ensure(name)
        result.append({
            "name": name,
            "description": db_categories.get(name, {}).get("description"),
            "resource_count": category_counts.get(name, 0),
        })
    
    return sorted(result, key=lambda x: x["name"])


@router.post("", response_model=CategoryResponse)
async def create_category(request: CategoryCreateRequest):
    category_repo.ensure(request.name, request.description)
    category_repo.refresh_counts()
    categories = {item["name"]: item for item in category_repo.list()}
    return categories[request.name]


@router.delete("/{name}")
async def delete_category(name: str, delete_resources: bool = False):
    if delete_resources:
        resources = resource_repo.list(category=name)
        for resource in resources:
            resource_repo.soft_delete(resource.id)
        delete_documents_by_category(name)
    category_repo.delete(name)
    return {"status": "deleted", "category": name, "resources_deleted": delete_resources}

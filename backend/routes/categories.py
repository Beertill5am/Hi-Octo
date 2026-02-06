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
    """List categories from DB and vectorstore."""
    category_repo.refresh_counts()
    db_categories = {item["name"]: item for item in category_repo.list()}
    vector_categories = list_vectorstore_categories()

    for name in vector_categories:
        if name not in db_categories:
            category_repo.ensure(name)
            db_categories[name] = {
                "name": name,
                "description": None,
                "resource_count": 0,
            }

    category_repo.refresh_counts()
    return list(db_categories.values())


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

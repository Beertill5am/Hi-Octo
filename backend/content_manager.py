import hashlib
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings

from modelTest5 import DB_PATH, get_available_categories, set_vectorstore

_VECTORSTORE: Optional[Chroma] = None
_COLLECTION_NAME = "python_knowledge_base_v2"


def get_vectorstore() -> Chroma:
    global _VECTORSTORE
    if _VECTORSTORE is None:
        embeddings = OllamaEmbeddings(model="nomic-embed-text:latest")
        _VECTORSTORE = Chroma(
            persist_directory=DB_PATH,
            embedding_function=embeddings,
            collection_name=_COLLECTION_NAME,
        )
        set_vectorstore(_VECTORSTORE)
    return _VECTORSTORE


def calculate_file_hash(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def enrich_metadata(metadata: Dict[str, Any], category: str) -> Dict[str, Any]:
    enriched = {
        "category": category,
        "ingested_at": datetime.now().isoformat(),
        **metadata,
    }
    return {k: v for k, v in enriched.items() if v is not None}


def add_documents(
    documents: List[Any], category: str, resource_metadata: Dict[str, Any]
) -> int:
    vectorstore = get_vectorstore()
    for doc in documents:
        doc.metadata = enrich_metadata({**doc.metadata, **resource_metadata}, category)
    vectorstore.add_documents(documents)
    return len(documents)


def delete_documents_by_resource(resource_id: str) -> None:
    vectorstore = get_vectorstore()
    try:
        vectorstore.delete(where={"resource_id": resource_id})
    except Exception:
        vectorstore._collection.delete(where={"resource_id": resource_id})


def delete_documents_by_category(category: str) -> None:
    vectorstore = get_vectorstore()
    try:
        vectorstore.delete(where={"category": category})
    except Exception:
        vectorstore._collection.delete(where={"category": category})


def list_vectorstore_categories() -> List[str]:
    vectorstore = get_vectorstore()
    return get_available_categories(vectorstore)


def create_markdown_payload(text: str, metadata: Dict[str, Any]) -> str:
    yaml_lines = ["---"]
    for key, value in metadata.items():
        if value is None:
            continue
        yaml_lines.append(f'{key}: "{value}"')
    yaml_lines.append("---")
    yaml_lines.append("")
    yaml_lines.append(text)
    return "\n".join(yaml_lines)


def write_web_resource_file(
    base_dir: str,
    resource_id: str,
    text: str,
    metadata: Dict[str, Any],
) -> str:
    os.makedirs(base_dir, exist_ok=True)
    file_path = os.path.join(base_dir, f"web_{resource_id}.md")
    payload = create_markdown_payload(text, metadata)
    with open(file_path, "w", encoding="utf-8") as handle:
        handle.write(payload)
    return file_path

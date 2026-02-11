"""Ingestion and retrieval building blocks for the agent pipeline."""

import hashlib
import os
import re
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Protocol, Type

import pypandoc
from ebooklib import epub
from langchain_chroma import Chroma
from langchain_classic.retrievers import ContextualCompressionRetriever, EnsembleRetriever
from langchain_community.document_compressors import FlashrankRerank
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field

from agent_pipeline_extensions import (
    create_fallback_response,
    preflight_analysis,
    print_preflight_report,
    register_all_specialists,
    safe_llm_invoke,
)


def _extract_json(text: str) -> str:
    """Find the first JSON object in a string."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return match.group(0) if match else text


def calculate_file_hash(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


class DocumentSpecialist(Protocol):
    def convert(self, file_path: str) -> str:
        ...


class IngestionRouter:
    def __init__(self):
        self._specialists: Dict[str, Type[DocumentSpecialist]] = {}

    def register(self, extension: str, specialist: Type[DocumentSpecialist]):
        self._specialists[extension.lower()] = specialist
        print(f"✅ Registered specialist for: {extension}")

    def route(self, file_path: str) -> str:
        ext = os.path.splitext(file_path)[1].lower()
        specialist_cls = self._specialists.get(ext)
        if not specialist_cls:
            raise ValueError(f"❌ No specialist found for extension: {ext}")
        print(f"🔄 Routing '{os.path.basename(file_path)}' to {specialist_cls.__name__}...")
        return specialist_cls().convert(file_path)


router = IngestionRouter()


class EPUBSpecialist:
    def _wrap_metadata(self, content: str, title: str, author: str, source: str, ftype: str) -> str:
        title = title if title else "Unknown"
        author = author if author else "Unknown"
        return f"""---
            title: "{title}"
            author: "{author}"
            source: "{source}"
            type: "{ftype}"
            ---

            {content}
            """

    def convert(self, file_path: str) -> str:
        print(f"📘 Pandoc: Converting '{os.path.basename(file_path)}'...")
        try:
            book = epub.read_epub(file_path)
            title = book.get_metadata("DC", "title")[0][0] if book.get_metadata("DC", "title") else "Unknown"
            author = (
                book.get_metadata("DC", "creator")[0][0] if book.get_metadata("DC", "creator") else "Unknown"
            )
            content = pypandoc.convert_file(
                file_path,
                "markdown",
                format="epub",
                extra_args=["--markdown-headings=atx", "--wrap=none"],
            )
            content = self._sanitize_content(content)
            return self._wrap_metadata(content, title, author, file_path, "epub")
        except OSError:
            return "❌ Error: Pandoc not found. Please install the system binary."
        except Exception as e:
            return f"❌ EPUB Error: {e}"

    def _sanitize_content(self, text: str) -> str:
        text = re.sub(r"^:{3,}.*$", "", text, flags=re.MULTILINE)
        text = re.sub(r"\[(.*?)\]\{[.#][^}]+\}", r"\1", text)
        text = re.sub(r"\{[.#][^}]+\}", "", text)
        text = re.sub(r"\[\]", "", text)
        text = re.sub(r"!\[.*?\]\(.*?\)", "", text)
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


router.register(".epub", EPUBSpecialist)
register_all_specialists(router)


class VerboseFlashrank(FlashrankRerank):
    def compress_documents(self, documents: List[Document], query: str, callbacks=None) -> List[Document]:
        print(f"\n👀 RERANKER INPUT: Received {len(documents)} documents from the Ensemble Retriever.")
        start = time.time()
        results = super().compress_documents(documents, query, callbacks)
        end = time.time()
        print(f"📉 RERANKER OUTPUT: Keeping top {len(results)} documents (Took {end-start:.2f}s).")
        return results


def intelligent_chunking(markdown_text: str) -> List[Document]:
    print("✂️ Splitting document by logical headers...")
    headers_to_split_on = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3")]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    md_header_splits = markdown_splitter.split_text(markdown_text)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    final_splits = text_splitter.split_documents(md_header_splits)
    print(f"   ✅ Created {len(final_splits)} semantic chunks.")
    return final_splits


def needs_refinement_heuristic(text: str) -> bool:
    if len(text) < 50:
        return False
    ambiguous_starts = [
        r"^(It|This|That|They|These|Those|He|She)\s+[a-z]",
        r"^(However|But|Also|Furthermore),\s+(it|this|they)",
        r"^In\s+contrast,\s+(it|this|they)",
    ]
    for pattern in ambiguous_starts:
        if re.match(pattern, text, re.IGNORECASE):
            return True
    return False


def create_refinement_batches(splits: List[Document], batch_size: int = 5) -> List[Dict[str, Any]]:
    batches: List[Dict[str, Any]] = []
    for i in range(0, len(splits), batch_size):
        batch_splits = splits[i : i + batch_size]
        formatted_text = ""
        batch_metadata: List[Dict[str, Any]] = []
        for idx, split in enumerate(batch_splits):
            needs_check = needs_refinement_heuristic(split.page_content)
            flag = "[POTENTIAL_AMBIGUITY]" if needs_check else ""
            formatted_text += f"ID: {idx}\nCONTENT: {split.page_content}\n{flag}\n-----------------\n"
            batch_metadata.append({"original_index": i + idx, "needs_heuristic_check": needs_check})
        batches.append({"formatted_text": formatted_text, "metadata": batch_metadata, "raw_splits": batch_splits})
    print(f"   📦 Grouped {len(splits)} chunks into {len(batches)} batches for efficient processing.")
    return batches


class BatchCorrection(BaseModel):
    corrections: Dict[int, str] = Field(
        description="Map of ID to the REWRITTEN text. Only include chunks that needed fixing."
    )


def process_batch_with_llm(
    batch: Dict[str, Any],
    display_callback: Optional[Callable[[str], None]] = None,
) -> Dict[int, str]:
    if not any(item["needs_heuristic_check"] for item in batch["metadata"]):
        return {}

    llm_reviewer = ChatOllama(model="deepseek-v3.1:671b-cloud", temperature=0.2, num_ctx=64000)
    review_prompt = f"""
    You are a Technical Editor. Review the text chunks.
    [INPUT]: {batch['formatted_text']}

    [TASK]:
    Identify chunks starting with ambiguous pronouns referring to previous chunks.

    [OUTPUT]:
    - If a chunk needs fixing, write: "ID: <id> REWRITE: <new_text>"
    - If NO chunks need fixing, write: "NO CHANGES NEEDED."
    """

    response = safe_llm_invoke(
        llm_reviewer,
        review_prompt,
        max_retries=2,
        fallback_value=create_fallback_response("NO CHANGES NEEDED"),
        operation_name="Batch Review",
    )
    raw_analysis = response.content if response else "NO CHANGES NEEDED"
    if display_callback:
        display_callback(raw_analysis)

    if "NO CHANGES NEEDED" in raw_analysis.upper() or "NO CHUNKS NEED" in raw_analysis.upper():
        return {}

    llm_formatter = ChatOllama(model="qwen3-coder:480b-cloud", format="json", temperature=0.1, num_ctx=64000)
    format_prompt = f"""
    You are a JSON Extractor. Extract the ID and REWRITE pairs from the text below.

    [TEXT]:
    {raw_analysis}

    [JSON SCHEMA]:
    Return a JSON object with a single key "corrections".
    Example: {{ "corrections": {{ "1": "Python is dynamic", "4": "The loop ends" }} }}
    """

    try:
        response = llm_formatter.invoke(format_prompt).content
        result = BatchCorrection.model_validate_json(_extract_json(response))
        return result.corrections
    except Exception as e:
        print(f"      ⚠️ Batch processing warning: {e}. Skipping refinements for this batch.")
        return {}


def get_available_categories(vectorstore: Chroma) -> List[str]:
    data = vectorstore.get(include=["metadatas"])
    categories = set()
    for meta in data["metadatas"]:
        if meta and "category" in meta:
            categories.add(meta["category"])
    return list(categories)


def build_retriever(
    file_paths: List[str],
    category: str,
    db_path: str,
    force_skip_refinement: bool = False,
    display_callback: Optional[Callable[[str], None]] = None,
):
    print(f"--- 📂 Knowledge Base: {db_path} ---")
    embeddings = OllamaEmbeddings(model="nomic-embed-text:latest")
    vectorstore = Chroma(
        persist_directory=db_path,
        embedding_function=embeddings,
        collection_name="python_knowledge_base_v2",
    )

    existing_data = vectorstore.get(include=["metadatas"])
    existing_hashes = {m.get("file_hash") for m in existing_data["metadatas"] if m and "file_hash" in m}

    files_to_ingest = []
    for path in file_paths:
        if not os.path.exists(path):
            print(f"   ⚠️ Warning: Source file not found: {path}")
            continue
        current_hash = calculate_file_hash(path)
        if current_hash not in existing_hashes:
            files_to_ingest.append((path, current_hash))

    if not files_to_ingest:
        print("   ✅ Database is fully synchronized. Skipping ingestion.")
    else:
        print(f"   🔄 Detected {len(files_to_ingest)} new/modified documents. Starting ingestion...")
        for path, file_hash in files_to_ingest:
            try:
                markdown_content = router.route(path)
                splits = intelligent_chunking(markdown_content)
                preflight = preflight_analysis(splits)
                print_preflight_report(preflight)

                skip_refinement = force_skip_refinement or preflight["skip_refinement"]
                if skip_refinement:
                    print("      ⚡ FAST MODE: Skipping LLM refinement")
                else:
                    print(f"      🧠 Optimizing {len(splits)} chunks for '{os.path.basename(path)}'...")
                    batches = create_refinement_batches(splits, batch_size=10)
                    for batch in batches:
                        try:
                            corrections = process_batch_with_llm(batch, display_callback=display_callback)
                            for local_id, new_text in corrections.items():
                                if local_id < len(batch["metadata"]):
                                    meta = batch["metadata"][local_id]
                                    global_idx = meta["original_index"]
                                    splits[global_idx].page_content = new_text
                                    splits[global_idx].metadata["is_refined"] = True
                        except Exception as batch_error:
                            print(f"      ⚠️ Batch failed: {batch_error}. Continuing...")
                            continue

                for split in splits:
                    if "raw_content" not in split.metadata:
                        split.metadata["raw_content"] = split.page_content
                    split.metadata["file_hash"] = file_hash
                    split.metadata["category"] = category
                    split.metadata["ingested_at"] = datetime.now().isoformat()
                    split.metadata["source"] = os.path.basename(path)

                vectorstore.add_documents(splits)
                print(f"      ✅ Ingested '{os.path.basename(path)}'.")
            except Exception as e:
                print(f"      ❌ Failed to process '{path}': {e}")

    print("--- ⚙️ Configuring Hybrid RAG Pipeline ---")
    all_docs = vectorstore.get(where={"category": category}, include=["documents", "metadatas"])
    if not all_docs["documents"]:
        print("   ⚠️ Warning: DB is empty. Returning basic retriever.")
        return vectorstore.as_retriever()

    documents = [Document(page_content=doc, metadata=meta) for doc, meta in zip(all_docs["documents"], all_docs["metadatas"])]

    semantic_retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 10, "fetch_k": 30, "filter": {"category": category}},
    )
    keyword_retriever = BM25Retriever.from_documents(documents)
    keyword_retriever.k = 10

    ensemble_retriever = EnsembleRetriever(retrievers=[keyword_retriever, semantic_retriever], weights=[0.3, 0.7])
    compressor = VerboseFlashrank(model="ms-marco-MiniLM-L-12-v2", top_n=10)
    final_retriever = ContextualCompressionRetriever(base_compressor=compressor, base_retriever=ensemble_retriever)
    return final_retriever, vectorstore


__all__ = [
    "router",
    "intelligent_chunking",
    "get_available_categories",
    "build_retriever",
]


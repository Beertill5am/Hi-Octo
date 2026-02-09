#!/usr/bin/env python
# coding: utf-8

# In[1]:


import os
import time
import operator
import hashlib
import re
import ast
import json
import markdown
import functools
import traceback
from datetime import datetime
import pypandoc
from ebooklib import epub
from markdownify import markdownify as md
from typing import Protocol, Type, TypedDict, List, Dict, Any, Annotated, Union, Optional, Callable
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from langchain_ollama import ChatOllama
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langgraph.graph import StateGraph, END
from langchain_community.retrievers import BM25Retriever
from langchain_classic.retrievers import EnsembleRetriever, ContextualCompressionRetriever
from langgraph.types import Send
from langchain_experimental.utilities import PythonREPL
from flashrank import Ranker
from langchain_community.document_compressors import FlashrankRerank
from pydantic import BaseModel, Field, AliasChoices
from IPython.display import Image, display, HTML

# Import extensions for multi-format support, pre-flight analysis, and error handling
from modelTest5_extensions import (
    register_all_specialists,
    preflight_analysis,
    print_preflight_report,
    safe_llm_invoke,
    safe_json_parse,
    create_fallback_response,
    safe_code_execution,
    should_attempt_fix,
    update_thresholds,
    REFINEMENT_THRESHOLDS
)

# Import content filter and web search
from content_filter import UniversalContentFilter, create_guardrail_node, route_from_guardrail
from web_search_agent import WebSearchAgent, create_web_search_node


# In[ ]:


OLLAMA_API_KEY = os.environ["OLLAMA_API_KEY"] 


# In[3]:


DB_PATH = "./agent_knowledge_db"
SOURCE_FILES = ["books/think_python_how_to_think_like_a_computer_scientist.epub",
               "books/python_crash_course.epub",
               "books/python_data_structures_and_algorithms.epub",
               "books/fluent_python.epub",
               "books/python_dataTypes.md"]


# In[4]:


def display_model_thoughts(thought_content):
    if os.environ.get("OCTO_ENABLE_NOTEBOOK_UI", "").strip() != "1":
        return
    try:
        from IPython import get_ipython
        if not get_ipython(): return
    except: return

    # Convert markdown to HTML
    html_content = markdown.markdown(thought_content, extensions=['extra', 'fenced_code'])

    # Custom CSS to fix the <code> tags and improve the look
    style = """
    <style>
        .thought-container {
            border: 1px solid #d1d9e0;
            border-left: 6px solid #4a90e2;
            background-color: #f6f8fa;
            padding: 16px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
            margin: 10px 0;
        }
        .thought-container summary {
            cursor: pointer;
            font-weight: 600;
            color: #4a90e2;
            outline: none;
            list-style: none; /* Removes the default arrow in some browsers */
        }
        /* This removes the black highlights from text in backticks */
        .thought-container code {
            background-color: rgba(175, 184, 193, 0.2);
            color: #24292f;
            padding: 0.2em 0.4em;
            border-radius: 6px;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            font-size: 85%;
        }
        .thought-content {
            margin-top: 12px;
            color: #24292f;
            line-height: 1.6;
            font-size: 14px;
        }
    </style>
    """

    # Using <details> makes the reasoning collapsible
    display(HTML(f"""
        {style}
        <div class="thought-container">
            <details open>
                <summary>🧠 Model Reasoning</summary>
                <div class="thought-content">{html_content}</div>
            </details>
        </div>
    """))


# In[5]:


class AdvancedTraceLogger:
    """
    Pattern: Observability (Chapter 18)
    Captures the full 'Agent Trajectory' (Chapter 19) including state transitions and latency.
    """
    def __init__(self):
        self.trace_id = None
        self.events = []

    def start_trace(self, topic: str):
        self.trace_id = f"run_{int(time.time())}"
        self.events = []
        print(f"🔴 STARTING TRACE: {self.trace_id} | Goal: '{topic}'")

    def log_event(self, node_name: str, event_type: str, payload: Any, latency: float = 0.0):
        """
        Logs a structured event.
        event_type: 'execution', 'error', 'state_update'
        """
        entry = {
            "timestamp": datetime.now().isoformat(),
            "node": node_name,
            "type": event_type,
            "latency": round(latency, 4),
            "payload": str(payload)[:200] + "..." if len(str(payload)) > 200 else payload # Truncate for display
        }
        self.events.append(entry)

        # Real-time console output
        if event_type == "error":
            print(f"   ❌ {node_name}: {entry['payload']}")
        else:
            print(f"   ⏱️  {node_name}: {entry['latency']}s")

    def print_trajectory(self):
        """
        Pattern: Agent Trajectories (Chapter 19, Pg 316)
        Visualizes the sequence of steps taken to reach the solution.
        """
        print(f"\n🗺️ AGENT TRAJECTORY: {self.trace_id}")
        print("="*60)
        total_time = sum(e['latency'] for e in self.events)

        for i, event in enumerate(self.events):
            icon = "⚡" if event['type'] == 'execution' else "⚠️"
            print(f"{i+1:02d}. {icon} {event['node']:<15} | {event['latency']:<6}s | {event['payload']}")

        print("-" * 60)
        print(f"Total Execution Time: {round(total_time, 2)}s")
        print("="*60)

    def save_trace(self, filename: str = "agent_trace.json"):
        """
        Persists the trace to a file for auditing and replay.
        """
        data = {
            "trace_id": self.trace_id,
            "events": self.events
        }

        with open(filename, "w") as f:
            json.dump(data, f, indent=2)

        print(f"\n💾 Trace successfully saved to '{filename}'")

# Singleton Instance
tracer = AdvancedTraceLogger()

def traceable(func):
    """
    Decorator to automatically log node execution, latency, and errors.
    Pattern: Modularity (Chapter 18, Pg 302) - Separates logging logic from business logic.
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        node_name = func.__name__
        start_time = time.time()

        try:
            # 1. Execute the Node
            result = func(*args, **kwargs)
            duration = time.time() - start_time

            # 2. Log Success
            # We log the *result* (state update) to see what changed
            tracer.log_event(node_name, "execution", result, duration)
            return result

        except Exception as e:
            duration = time.time() - start_time
            # 3. Log Error 
            error_msg = f"{type(e).__name__}: {str(e)}"
            tracer.log_event(node_name, "error", error_msg, duration)
            raise e # Re-raise to let LangGraph handle or crash

    return wrapper


# In[6]:


def extract_json(text: str) -> str:
    """Finds the first JSON object or array in a string."""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    return match.group(0) if match else text


# In[7]:


def calculate_file_hash(file_path: str):
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        # Read in blocks to handle large files efficiently
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


# In[8]:


# 1. The Interface: All future specialists MUST follow this contract
class DocumentSpecialist(Protocol):
    def convert(self, file_path: str) -> str:
        """
        Reads a file and returns its content as Structured Markdown.
        """
        ...

# 2. The Router: Manages traffic based on file extensions
class IngestionRouter:
    def __init__(self):
        # Maps extension (e.g., .pdf) to a Specialist Class
        self._specialists: Dict[str, Type[DocumentSpecialist]] = {}

    def register(self, extension: str, specialist: Type[DocumentSpecialist]):
        """Connects a file extension to a specific handler class."""
        self._specialists[extension.lower()] = specialist
        print(f"✅ Registered specialist for: {extension}")

    def route(self, file_path: str) -> str:
        """Detects extension and calls the right specialist."""
        ext = os.path.splitext(file_path)[1].lower()
        specialist_cls = self._specialists.get(ext)

        if not specialist_cls:
            raise ValueError(f"❌ No specialist found for extension: {ext}")

        print(f"🔄 Routing '{os.path.basename(file_path)}' to {specialist_cls.__name__}...")

        # Instantiate and run the specialist
        return specialist_cls().convert(file_path)

# Initialize the global router
router = IngestionRouter()


# In[9]:


class EPUBSpecialist:
    def _wrap_metadata(self, content: str, title: str, author: str, source: str, ftype: str) -> str:
        """Standardizes the output format with YAML frontmatter."""
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
            # 1. Metadata Extraction 
            book = epub.read_epub(file_path)
            title = book.get_metadata('DC', 'title')[0][0] if book.get_metadata('DC', 'title') else "Unknown"
            author = book.get_metadata('DC', 'creator')[0][0] if book.get_metadata('DC', 'creator') else "Unknown"

            # 2. Structural Conversion (via pypandoc)
            content = pypandoc.convert_file(
                file_path, 
                'markdown',
                format='epub', 
               extra_args=[
                    '--markdown-headings=atx', 
                    '--wrap=none'
                ]
            )

            content = self._sanitize_content(content)

            # 3. Standardization
            return self._wrap_metadata(content, title, author, file_path, "epub")

        except OSError:
            return "❌ Error: Pandoc not found. Please install the system binary."
        except Exception as e:
            return f"❌ EPUB Error: {e}"

    def _sanitize_content(self, text: str) -> str:
        """
        Removes Pandoc artifacts, images, and empty anchors.
        """
        # 1. Remove Fenced Divs 
        text = re.sub(r'^:{3,}.*$', '', text, flags=re.MULTILINE)

        # 2. Smart Unwrapping
        text = re.sub(r'\[(.*?)\]\{[.#][^}]+\}', r'\1', text)

        # 3. Cleanup Straggler Attributes
        text = re.sub(r'\{[.#][^}]+\}', '', text)

        # 4. Remove residual empty brackets 
        text = re.sub(r'\[\]', '', text)

        # 5. Remove Images
        text = re.sub(r'!\[.*?\]\(.*?\)', '', text)

        # 6. Remove HTML tags
        text = re.sub(r'<[^>]+>', '', text)

        # 7. Collapse excessive whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)

        return text.strip()
router.register(".epub", EPUBSpecialist)

# Register all additional document specialists (TXT, MD, DOCX, PDF)
register_all_specialists(router)


# In[10]:


class VerboseFlashrank(FlashrankRerank):
    def compress_documents(self, documents: List[Document], query: str, callbacks=None) -> List[Document]:
        # 1. Print Input Count
        print(f"\n👀 RERANKER INPUT: Received {len(documents)} documents from the Ensemble Retriever.")

        # 2. Run the actual Flashrank logic
        start = time.time()
        results = super().compress_documents(documents, query, callbacks)
        end = time.time()

        # 3. Print Output Count
        print(f"📉 RERANKER OUTPUT: Keeping top {len(results)} documents (Took {end-start:.2f}s).")
        return results


# In[11]:


def intelligent_chunking(markdown_text: str):
    print("✂️ Splitting document by logical headers...")

    # 1. Define the Hierarchy
    # We tell the splitter to look for these specific Markdown patterns
    headers_to_split_on = [
        ("#", "Header 1"),     
        ("##", "Header 2"),     
        ("###", "Header 3"),    
    ]

    # 2. First Pass: Logical Splitting
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    md_header_splits = markdown_splitter.split_text(markdown_text)

    # 3. Second Pass: Size Constraints
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000, 
        chunk_overlap=200
    )

    # Split the logical chunks into manageable vector-sized bits
    final_splits = text_splitter.split_documents(md_header_splits)

    print(f"   ✅ Created {len(final_splits)} semantic chunks.")
    return final_splits


# In[12]:


def needs_refinement_heuristic(text: str) -> bool:
    """
    Pattern: Routing (Chapter 2) & Resource-Aware Optimization (Chapter 16)
    Deterministic check to filter out chunks that clearly don't need AI attention.
    Returns True if the chunk looks ambiguous and needs LLM review.
    """
    # 1. Noise Filter: Skip very short chunks
    if len(text) < 50:
        return False

    # 2. Ambiguity Detector
    ambiguous_starts = [
        r"^(It|This|That|They|These|Those|He|She)\s+[a-z]", 
        r"^(However|But|Also|Furthermore),\s+(it|this|they)",
        r"^In\s+contrast,\s+(it|this|they)"
    ]

    for pattern in ambiguous_starts:
        if re.match(pattern, text, re.IGNORECASE):
            return True

    return False


# In[13]:


def create_refinement_batches(splits: List[Document], batch_size: int = 5) -> List[Dict]:
    """
    Pattern: Resource-Aware Optimization
    Groups chunks into batches to minimize LLM calls.

    Args:
        splits: The list of document chunks.
        batch_size: Number of chunks to process in one LLM call.

    Returns:
        A list of batch dictionaries containing formatted text and metadata.
    """
    batches = []

    # Iterate through splits in steps of 'batch_size'
    for i in range(0, len(splits), batch_size):
        batch_splits = splits[i : i + batch_size]

        # 1. Format the batch for the LLM
        formatted_text = ""
        batch_metadata = []

        for idx, split in enumerate(batch_splits):
            # Check our heuristic from Step 1
            needs_check = needs_refinement_heuristic(split.page_content)

            # We flag it visually for the LLM, but we send the whole batch 
            # so the LLM has context to fix the specific ambiguous ones.
            flag = "[POTENTIAL_AMBIGUITY]" if needs_check else ""

            formatted_text += f"ID: {idx}\nCONTENT: {split.page_content}\n{flag}\n-----------------\n"

            # Keep track of original objects to update them later
            batch_metadata.append({
                "original_index": i + idx,
                "needs_heuristic_check": needs_check
            })

        batches.append({
            "formatted_text": formatted_text,
            "metadata": batch_metadata,
            "raw_splits": batch_splits
        })

    print(f"   📦 Grouped {len(splits)} chunks into {len(batches)} batches for efficient processing.")
    return batches


# In[14]:


class BatchCorrection(BaseModel):
    """
    Pattern: Structured Output
    Captures only the necessary changes. Keys are the IDs from the batch.
    """
    corrections: Dict[int, str] = Field(
        description="Map of ID to the REWRITTEN text. Only include chunks that needed fixing."
    )

def process_batch_with_llm(batch: Dict) -> Dict[int, str]:
    """
    Pattern: Listwise Evaluation (Chapter 19) & Model Specialization (Chapter 16)
    1. Heuristic Gatekeeper: Fast exit if no potential ambiguity.
    2. Reviewer (DeepSeek): Reasons about context and proposes fixes.
    3. Formatter (Qwen): structured output extraction.
    """
    # 1. Heuristic Gatekeeper
    if not any(item['needs_heuristic_check'] for item in batch['metadata']):
        return {}

    # 2. Reviewer Agent
    #llm_reviewer = ChatOllama(model="deepseek-r1:8b", temperature=0.1, num_ctx=8192)
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

    # Run the reasoning step with safe invoke
    response = safe_llm_invoke(
        llm_reviewer, 
        review_prompt,
        max_retries=2,
        fallback_value=create_fallback_response("NO CHANGES NEEDED"),
        operation_name="Batch Review"
    )
    raw_analysis = response.content if response else "NO CHANGES NEEDED"

    # Visualize the editor's thought process
    display_model_thoughts(raw_analysis)

    if "NO CHANGES NEEDED" in raw_analysis.upper() or "NO CHUNKS NEED" in raw_analysis.upper():
        return {}

    # 3. Formatter Agent
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
        # Invoke Formatting
        response = llm_formatter.invoke(format_prompt).content

        # Parse output using Pydantic
        result = BatchCorrection.model_validate_json(extract_json(response))
        return result.corrections

    except Exception as e:
        print(f"      ⚠️ Batch processing warning: {e}. Skipping refinements for this batch.")
        return {}


# In[15]:


def get_available_categories(vectorstore: Chroma) -> List[str]:
    """
    Pattern: Agent Discovery (Chapter 15)
    Dynamically identifies what knowledge domains exist in the DB.
    """
    # Fetch only metadata to be efficient
    data = vectorstore.get(include=["metadatas"])

    # Extract unique categories using a set
    categories = set()
    for meta in data["metadatas"]:
        if meta and "category" in meta:
            categories.add(meta["category"])

    return list(categories)


# In[ ]:


def build_retriever(file_paths: List[str], category: str, force_skip_refinement: bool = False):
    print(f"--- 📂 Knowledge Base: {DB_PATH} ---")

    # 1. Initialize VectorDB (Connect to persistent storage)
    embeddings = OllamaEmbeddings(model="nomic-embed-text:latest")
    vectorstore = Chroma(
        persist_directory=DB_PATH,
        embedding_function=embeddings,
        collection_name="python_knowledge_base_v2" 
    )

    # 2. Resource-Aware Check: What do we actually need to do?
    # We fetch only metadata to be fast
    existing_data = vectorstore.get(include=['metadatas'])

    # Create a set of existing file hashes for O(1) lookups
    existing_hashes = {
        m.get('file_hash') for m in existing_data['metadatas'] 
        if m and 'file_hash' in m
    }

    # Identify which files are actually new
    files_to_ingest = []
    for path in file_paths:
        if not os.path.exists(path):
            print(f"   ⚠️ Warning: Source file not found: {path}")
            continue

        current_hash = calculate_file_hash(path)
        if current_hash not in existing_hashes:
            files_to_ingest.append((path, current_hash))

    # 3. The "Fast Path" 
    if not files_to_ingest:
        print("   ✅ Database is fully synchronized. Skipping ingestion.")
    else:
        # 4. Perform Ingestion only for new files
        print(f"   🔄 Detected {len(files_to_ingest)} new/modified documents. Starting ingestion...")

        for path, file_hash in files_to_ingest:
            try:
                # Routing & Splitting
                markdown_content = router.route(path)
                splits = intelligent_chunking(markdown_content)

                # NEW: Pre-flight Analysis
                preflight = preflight_analysis(splits)
                print_preflight_report(preflight)
                
                # Determine if we should skip refinement
                skip_refinement = force_skip_refinement or preflight["skip_refinement"]
                
                if skip_refinement:
                    print(f"      ⚡ FAST MODE: Skipping LLM refinement")
                else:
                    # Listwise Reflection 
                    print(f"      🧠 Optimizing {len(splits)} chunks for '{os.path.basename(path)}'...")
                    batches = create_refinement_batches(splits, batch_size=10) 

                    for batch in batches:
                        try:
                            corrections = process_batch_with_llm(batch)
                            for local_id, new_text in corrections.items():
                                if local_id < len(batch['metadata']):
                                    meta = batch['metadata'][local_id]
                                    global_idx = meta['original_index']
                                    splits[global_idx].page_content = new_text
                                    splits[global_idx].metadata["is_refined"] = True
                        except Exception as batch_error:
                            print(f"      ⚠️ Batch failed: {batch_error}. Continuing...")
                            continue

                # Enrichment
                for split in splits:
                    if "raw_content" not in split.metadata:
                        split.metadata["raw_content"] = split.page_content

                    split.metadata["file_hash"] = file_hash
                    split.metadata["category"] = category
                    split.metadata["ingested_at"] = datetime.now().isoformat()
                    split.metadata["source"] = os.path.basename(path)

                # Indexing
                vectorstore.add_documents(splits)
                print(f"      ✅ Ingested '{os.path.basename(path)}'.")

            except Exception as e:
                print(f"      ❌ Failed to process '{path}': {e}")

    # 5. Pipeline Configuration 
    print("--- ⚙️ Configuring Hybrid RAG Pipeline ---")

    # Fetch docs for BM25 
    all_docs = vectorstore.get(where={"category": category}, include=['documents', 'metadatas'])

    if not all_docs['documents']:
        print("   ⚠️ Warning: DB is empty. Returning basic retriever.")
        return vectorstore.as_retriever()

    # Reconstruct Document objects for LangChain
    documents = [
        Document(page_content=doc, metadata=meta) 
        for doc, meta in zip(all_docs['documents'], all_docs['metadatas'])
    ]

    # Semantic Retriever 
    semantic_retriever = vectorstore.as_retriever(
        search_type="mmr", 
        search_kwargs={'k': 10, 'fetch_k': 30, 'filter': {'category': category}}
    )

    # Keyword Retriever 
    keyword_retriever = BM25Retriever.from_documents(documents)
    keyword_retriever.k = 10

    # Hybrid Ensemble
    ensemble_retriever = EnsembleRetriever(
        retrievers=[keyword_retriever, semantic_retriever],
        weights=[0.3, 0.7] 
    )

    # Reranker 
    compressor = VerboseFlashrank(
        model="ms-marco-MiniLM-L-12-v2", 
        top_n=10 
    )

    final_retriever = ContextualCompressionRetriever(
        base_compressor=compressor, 
        base_retriever=ensemble_retriever
    )

    return final_retriever, vectorstore


# In[17]:


class AgentState(TypedDict):
    topic: str
    job_id: str
    queries: List[str]
    documents: Annotated[List[Document], operator.add]
    is_relevant: bool
    available_categories: List[str]  
    selected_category: str           
    retry_count: int
    answer: str
    revision_count: int         
    critique_feedback: Annotated[List[str], operator.add]
    critique_praise: str
    blueprint: str
    # Guardrail state
    is_safe: bool
    rejection_message: str
    # Web search state  
    web_search_performed: bool
    web_search_answer: str
    web_search_results: List  # Raw search results
    # HITL state
    hitl_approved: bool
    hitl_message: str
    # Query-plan HITL state
    query_plan_approved: bool
    query_plan_message: str
    query_plan_rejection_reason: str


def _chunk_to_text(chunk: Any) -> str:
    """Normalize LLM stream chunk content into plain text."""
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                txt = item.get("text")
                if isinstance(txt, str):
                    parts.append(txt)
            else:
                txt = getattr(item, "text", "")
                if isinstance(txt, str):
                    parts.append(txt)
        return "".join(parts)
    return str(content) if content is not None else ""


def _stream_writer_answer(llm_writer: ChatOllama, instruction: str, job_id: str) -> str:
    """
    Stream writer tokens through backend callback when available.
    Falls back to invoke() when stream is unavailable.
    """
    if answer_token_stream_handler is None:
        response = llm_writer.invoke(instruction)
        return response.content if response else ""

    final_parts: List[str] = []
    try:
        for chunk in llm_writer.stream(instruction):
            token = _chunk_to_text(chunk)
            if not token:
                continue
            final_parts.append(token)
            answer_token_stream_handler(
                job_id=job_id,
                token=token,
                done=False,
                final_text=""
            )
    except Exception:
        # Fallback to single-shot generation if streaming fails
        response = llm_writer.invoke(instruction)
        fallback = response.content if response else ""
        if fallback:
            final_parts.append(fallback)
            answer_token_stream_handler(
                job_id=job_id,
                token=fallback,
                done=False,
                final_text=""
            )

    final_answer = "".join(final_parts)
    answer_token_stream_handler(
        job_id=job_id,
        token="",
        done=True,
        final_text=final_answer
    )
    return final_answer


# In[18]:


class CritiqueResponse(BaseModel):
    """
    Pattern: Structured Output (Chapter 1, Pg 24)
    Ensures the Critic provides actionable data, not just text.
    """
    score: int = Field(description="Quality score from 0-10")
    feedback: str = Field(description="Specific, actionable instructions for improvement")
    what_to_keep: str = Field(description="List of excellent sections that MUST NOT be modified")
    accepted: bool = Field(description="True if score >= 8, else False")


# In[19]:


# A simple schema for the input to our worker node
class SearchRequest(TypedDict):
    query: str
    category: str

def search_worker_node(request: SearchRequest):
    """
    Executes a SINGLE search query. 
    Running multiple instances of this node in parallel replaces the loop.
    """
    query = request['query']
    category = request['category']

    print(f"    🚀 Worker launching: '{query}'")

    # Re-using your existing vectorstore logic
    results = vectorstore.similarity_search(
        query,
        k=5,
        filter={"category": category}
    )

    # Return directly to the global state 'documents' key
    return {"documents": results}


# In[20]:


def map_queries_node(state: AgentState):
    """
    Map step: Converts the list of queries into parallel execution requests.
    """
    queries = state.get('queries', [state['topic']])
    category = state['selected_category']

    if category == "out_of_domain":
        return [] # No work to do

    print(f"--- ⚡ Dispatching {len(queries)} parallel search workers ---")

    # We return a list of Send objects. 
    # Arg 1: The name of the node to call ("search_worker")
    # Arg 2: The specific input data for that node
    return [
        Send("search_worker", {"query": q, "category": category}) 
        for q in queries
    ]


def query_plan_hitl_node(state: AgentState):
    """
    Query-plan checkpoint immediately after expansion.
    Lets backend pause and request user approve/reject/edit of generated queries.
    """
    print("--- 👤 HITL Checkpoint: Query Plan Review ---")

    queries = state.get("queries", [])
    if not queries:
        return {
            "query_plan_approved": True,
            "query_plan_message": "No expanded queries available.",
            "query_plan_rejection_reason": ""
        }

    if query_plan_hitl_handler is None:
        print("   ⚠️ No query-plan HITL handler configured. Auto-approving.")
        return {
            "query_plan_approved": True,
            "query_plan_message": "Auto-approved (no query-plan HITL handler).",
            "query_plan_rejection_reason": ""
        }

    decision = query_plan_hitl_handler(
        job_id=state.get("job_id", ""),
        topic=state.get("topic", ""),
        selected_category=state.get("selected_category", ""),
        queries=queries
    ) or {}

    approved = bool(decision.get("approved", True))
    edited_queries = decision.get("queries", queries) or queries
    reason = str(decision.get("reason", ""))

    if approved:
        print(f"   ✅ Query plan approved with {len(edited_queries)} queries.")
        return {
            "queries": edited_queries,
            "query_plan_approved": True,
            "query_plan_message": "Query plan approved.",
            "query_plan_rejection_reason": ""
        }

    print("   ❌ Query plan rejected by user.")
    return {
        "query_plan_approved": False,
        "query_plan_message": "Query plan rejected.",
        "query_plan_rejection_reason": reason,
        "answer": "Query plan rejected by user before retrieval."
    }


def route_from_query_plan_hitl(state: AgentState) -> str:
    """Route after query-plan HITL decision."""
    if state.get("query_plan_approved", False):
        return "query_fanout"
    return "end_node"


def query_fanout_node(state: AgentState):
    """No-op node to attach dynamic fanout mapping after query-plan HITL."""
    return {}


# In[21]:


def deduplicate_node(state: AgentState):
    """
    Reduce step: Cleans up the messy parallel results.
    """
    raw_docs = state['documents']
    unique_contents = set()
    unique_docs = []

    for doc in raw_docs:
        if doc.page_content not in unique_contents:
            unique_contents.add(doc.page_content)
            unique_docs.append(doc)

    print(f"    ✅ Merged & Deduplicated: {len(unique_docs)} unique docs (from {len(raw_docs)} total).")
    # We overwrite the list with the clean version
    return {"documents": unique_docs}


# In[22]:


def increment_retry_node(state: AgentState):
    print("   🔄 Loop: Incrementing retry count...")
    return {"retry_count": state.get('retry_count', 0) + 1} 


# In[23]:


class RouteDecision(BaseModel):
    """Structured Output Pattern: Decoupled Reasoning and Formatting."""
    category: str = Field(description="The matching category from the available list, or 'out_of_domain'")
    reasoning: str = Field(description="The logical justification provided by the reasoning model")

def dispatcher_node(state: AgentState):
    print("--- 🚦 Decoupled Dispatcher: Routing Query ---")
    topic = state['topic']
    categories = state.get('available_categories', [])

    if not categories:
        print("   ⚠️ No categories found in state.")
        return {"selected_category": "out_of_domain"}

    # 1. Reasoning Stage - Chain of Thought 
    llm_reasoner = ChatOllama(model="deepseek-r1:8b", temperature=0.6, num_ctx=8192) 
    reasoning_prompt = f"""
    Analyze the user query and determine which domain it fits.
    [DOMAINS]: {json.dumps(categories)}
    [QUERY]: "{topic}"
    Explain your reasoning clearly and conclude with the best category.
    """
    raw_reasoning = llm_reasoner.invoke(reasoning_prompt).content

    # 2. Formatting Stage - Structured Output 
    llm_formatter = ChatOllama(model="qwen3:8b", format="json", temperature=0.1, num_ctx=8192,
                               additional_kwargs={"think": False})
    formatting_prompt = f"""
    Based on the reasoning below, route the query to a domain.
    [REASONING]: {raw_reasoning}
    [DOMAINS]: {json.dumps(categories)}
    [INSTRUCTIONS]:
    Return a JSON object with EXACTLY these two keys:
    1. "category": Must be one of the [DOMAINS] or "out_of_domain".
    2. "reasoning": A brief explanation.

    Example: {{ "category": "python", "reasoning": "The user is asking about string methods." }}
    """

    try:
        response = llm_formatter.invoke(formatting_prompt).content
        decision = RouteDecision.model_validate_json(response)
        selected = decision.category

        # Validation Guardrail 
        if selected not in categories and selected != "out_of_domain":
            selected = "out_of_domain"

    except Exception as e:
        print(f"❌ Formatting failed: {e}")
        selected = "out_of_domain"

    print(f"👉 Routed to: {selected}")
    return {"selected_category": selected}


# In[24]:


def expand_query_node(state: AgentState):
    print("--- 🧠 Expander: Reasoning & Generating Variations ---")
    topic = state['topic']
    current_retry = state.get('retry_count', 0)
    selected_category = state.get('selected_category')

    # 1. Fast Exit: Out of Domain
    if selected_category == "out_of_domain":
        print("⚠️ Out of domain detected. Skipping expansion.")
        return {"queries": []}

    # 2. Define Schema for Structured Output
    class QueryExpansion(BaseModel):
        queries: List[str] = Field(description="List of 5 search variations")

    # 3. Dynamic Prompting
    if current_retry > 0:
        print(f"🔄 Retry #{current_retry} detected. Broadening search scope.")
        instruction = (
            f"PREVIOUS SEARCH FAILED. The previous queries for '{topic}' were too narrow. "
            "Generate 5 NEW, BROADER, or ALTERNATIVE search queries. Focus on "
            "fundamental concepts, synonyms, and higher-level categories."
        )
    else:
        instruction = (
            f"Generate 5 distinct search queries for: '{topic}'. "
            "Think about synonyms, academic terms, and practical questions."
        )

    # 4. First Pass: Reasoning (DeepSeek-R1)
    llm_reasoning = ChatOllama(model="deepseek-r1:8b", temperature=0.7, num_ctx=8192)
    raw_response = llm_reasoning.invoke(instruction).content

    # Visualizing the thought process
    display_model_thoughts(raw_response)

    # 5. Second Pass: Formatting (Qwen-3)
    llm_formatter = ChatOllama(model="qwen3:4b-instruct", format="json", temperature=0.1, num_ctx=8192)

    formatting_prompt = [
        {"role": "system", "content": "You are a JSON extractor. Output a JSON object with a single key 'queries' containing a list of strings from the user's text."},
        {"role": "user", "content": f"Extract the search queries from this text:\n\n{raw_response}"}
    ]

    try:
        json_raw = llm_formatter.invoke(formatting_prompt).content
        # Ensure we handle potential Markdown code blocks in the JSON string
        parsed_output = QueryExpansion.model_validate_json(extract_json(json_raw))
        queries = parsed_output.queries
    except Exception as e:
        print(f"❌ JSON Extraction failed: {e}. Falling back to regex/split.")
        # Robust Fallback: Clean up lines that look like list items
        queries = [
            line.strip().lstrip('123456789.-* ').strip() 
            for line in raw_response.split('\n') 
            if any(line.strip().startswith(prefix) for prefix in ('1.', '-', '*'))
        ]

    # 6. Deduplicate and Finalize
    # We use a set to ensure uniqueness, then return the list
    final_queries = list(set(queries + [topic]))

    return {"queries": final_queries}


# In[25]:


def retrieve_node(state: AgentState):
    print(f"--- 🕵️ Researcher: Dynamic Retrieval ---")

    # 1. Get Inputs
    queries = state.get('queries', [state['topic']]) # Use the expanded queries!
    category = state['selected_category']

    # 2. Scope Guardrail
    if category == "out_of_domain":
        print("   ⛔ Query is out of domain. Skipping retrieval.")
        return {"documents": []}

    print(f"    🔍 Searching {len(queries)} queries in domain: '{category}'")

    all_docs = []

    # 3. Multi-Query Loop
    for q in queries:
        # We search directly against the vectorstore to apply the dynamic filter
        results = vectorstore.similarity_search(
            q,
            k=5,
            filter={"category": category} 
        )
        all_docs.extend(results)

    # 4. Deduplication Strategy (Set-based)
    # We use the page_content as the unique key
    unique_contents = set()
    unique_docs = []

    for doc in all_docs:
        if doc.page_content not in unique_contents:
            unique_contents.add(doc.page_content)
            unique_docs.append(doc)

    print(f"    ✅ Retrieved {len(unique_docs)} unique chunks (reduced from {len(all_docs)}).")

    return {"documents": unique_docs}


# In[26]:


def grade_documents_node(state: AgentState):
    """
    Pattern: Dual-Model Guardrail (Gate)
    1. DeepSeek-R1: Reasons if the content is relevant.
    2. Qwen: Extracts the binary 'yes'/'no' decision.
    """
    print("--- ⚖️ Grader: Verifying relevance (Dual-Model) ---")
    topic = state['topic']
    docs = state['documents']

    # Context Enrichment
    doc_txt_list = []
    for i, doc in enumerate(docs):
        # specific source info
        source = doc.metadata.get('source', 'Unknown')
        page = doc.metadata.get('page', 0) + 1

        # The stamped format the LLM will see
        entry = f"""
        [SOURCE ID: {i+1}]
        File: {source}
        Page: {page}
        Content: {doc.page_content}
        -------------------------------------------
        """
        doc_txt_list.append(entry)

    # Slice this for safety
    doc_txt = "\n".join(doc_txt_list)

    # 1. Define Schema
    class Grade(BaseModel):
        binary_score: str = Field(description="Relevance score 'yes' or 'no'")

    # 2. Reasoning (DeepSeek-R1)
    llm_reasoning = ChatOllama(model="deepseek-r1:8b", temperature=0.1, num_ctx=8192)
    prompt_reasoning = f"""
    User Topic: {topic}
    Retrieved Snippets:
    {doc_txt}

    Task: 
    1. Analyze if the snippets contain a definition or explanation of the topic.
    2. If relevant, YOU MUST CITE the 'SOURCE ID' and 'File Name' that proves it.
    3. Ignore bibliographies or random, unrelated code.
    4. Think step-by-step: Does this content explicitly address '{topic}'?
    """

    reasoning_content = llm_reasoning.invoke(prompt_reasoning).content
    display_model_thoughts(reasoning_content) 

    # 3. Formatting (Qwen)
    llm_formatter = ChatOllama(model="qwen3:8b", format="json", temperature=0.2, num_ctx=8192, 
                               additional_kwargs={"think": False})

    prompt_formatting = [
        {"role": "system", "content": "You are a grader. Output JSON with key 'binary_score' set to 'yes' or 'no'."},
        {"role": "user", "content": f"Based on this analysis, is the content relevant?\n\nAnalysis: {reasoning_content}"}
    ]

    try:
        result = llm_formatter.invoke(prompt_formatting).content
        grade = Grade.model_validate_json(extract_json(result))
        is_relevant = grade.binary_score.lower() == "yes"
    except Exception as e:
        print(f"❌ Grading format failed: {e}. Defaulting to 'no'.")
        is_relevant = False

    if is_relevant:
        print("   ✅ Grader: Content is RELEVANT.")
    else:
        print("   ⛔ Grader: Content is IRRELEVANT.")

    return {"is_relevant": is_relevant}


# In[27]:


def generate_answer_node(state: AgentState):
    print("--- 💡 Generator: The Triad Pipeline (Instrumented) ---")

    # --- State Extraction ---
    topic = state['topic']
    docs = state['documents']
    context = "\n\n".join([d.page_content for d in docs])

    # Iteration Logic
    revision_count = state.get('revision_count', 0)
    feedback = state.get('critique_feedback', None)
    existing_answer = state.get('answer', None)
    existing_blueprint = state.get('blueprint', None)

    # Variable to hold the plan to be passed to the state later
    current_blueprint = existing_blueprint

    # ============================================================
    # PHASE 1: REASONING & BLUEPRINTING (Run Once)
    # ============================================================
    # We only run the "Deep Thought" and "Architecture" steps on the first pass.
    # On subsequent loops, we stick to the original plan to avoid drift.

    if revision_count == 0:
        print("   🏗️  Phase 1: Analyzing and Blueprinting...")

        # --- A. REASONING ---
        llm_reasoning = ChatOllama(model="deepseek-r1:8b", temperature=0.6, num_ctx=8192)

        plan_prompt = f"""
        Context: {context}
        Question: {topic}

        Task: Deeply analyze the context and determine the best way to explain this to a newbie developer.
        Identify:
        1. The core concepts.
        2. The theoretical foundation
        3. The practical Python implementation details. The code structure required.
        4. Any caveats or specific details mentioned in the docs.
        5. Performance traps and common mistakes
        """
        raw_plan = llm_reasoning.invoke(plan_prompt).content
        display_model_thoughts(raw_plan)

        # --- B. BLUEPRINT (Qwen) ---
        llm_architect = ChatOllama(model="qwen3:8b", temperature=0.6, num_ctx=8192)

        architect_prompt = f"""
        You are a Technical Editor. 
        Review the raw analysis below and create a structured Markdown Outline for a tutorial article.

        Raw Analysis:
        {raw_plan}

        Structure the output strictly as:
        # Title
        ## 1. Executive Summary 
        ## 2. Core Concepts 
        ## 3. Python Implementation 
        ## 4. Performance Pitfalls
        ## 5. Real-World Analogy

        Rules:
        - Keep bullet points punchy.
        - Focus on the *best* examples.
        - Do NOT write the full article, just the skeleton.
        """
        current_blueprint = llm_architect.invoke(architect_prompt).content
        display_model_thoughts(current_blueprint)

    else:
        print(f"   🔄 Revision #{revision_count}: Skipping Blueprinting. Using existing plan.")

    # ============================================================
    # PHASE 2: WRITING / REFINING (Iterative)
    # ============================================================

    llm_writer = ChatOllama(model="gpt-oss:120b-cloud", temperature=0.7, num_ctx=64000) 

    # --- Branch A: First Draft ---
    if revision_count == 0:
        print("   ✍️  Phase 2: Writing Initial Draft...")
        instruction = f"""
        You are a Senior Technical Writer for "Real Python".
        Your goal is to write a comprehensive, engaging, and highly educational guide based on a specific BLUEPRINT.

        Topic: {topic}
        INSTRUCTIONS:
        1. STRICTLY follow the structure of the [BLUEPRINT] below.
        2. Use the [CONTEXT] ONLY as a database for code examples and facts.

        [BLUEPRINT]: 
        {current_blueprint}

        [CONTEXT]:
        {context}

        Style Guide:
        1. **Tone:** Authoritative but accessible. Use "We" and "You".
        2. **Code:** Extensively comment your code. Explain *why* it works.
        3. **Analogy:** Include a "Mental Model" section.
        """

    # --- Branch B: Refinement based on Critic ---
    else:
        print(f"   🛠️  Phase 2: Refining Draft based on Feedback...")
        # 1. Retrieve Praise (Current)
        praise = state.get('critique_praise', "None")

        # 2. Retrieve Feedback History (Memory)
        # Join the list into a single string
        feedback_history = "\n".join(state.get('critique_feedback', []))

        instruction = f"""
        You are a Senior Technical Writer. 
        Refine the following article based strictly on the CRITIC'S FEEDBACK.

        [ORIGINAL DRAFT]:
        {existing_answer}

        [CRITIC FEEDBACK (Negative Constraints)]:
        {feedback_history}

        [WHAT TO KEEP (Positive Constraints)]:
        {praise}

        [BLUEPRINT]:
        {current_blueprint}

        INSTRUCTIONS:
        1. REWRITE ONLY the sections highlighted in the [CRITIC FEEDBACK].
        2. STRICTLY PRESERVE the content listed in [WHAT TO KEEP]. Do not rewrite these sections.
        3. Maintain the original structure.
        """

    # --- Execution ---
    final_answer = _stream_writer_answer(
        llm_writer,
        instruction,
        state.get("job_id", "")
    )
    display_model_thoughts(final_answer)

    # Return updated state
    # We explicitly save the 'blueprint' so the Critic node can access it in the next step
    return {
        "answer": final_answer, 
        "blueprint": current_blueprint
    }


# In[28]:


def route_from_dispatcher(state: AgentState):
    """
    Pattern: Scope Guardrail (Chapter 18)
    """
    if state['selected_category'] == "out_of_domain":
        return "end_node" # Graceful exit
    else:
        return "expander" # Enter RAG pipeline

def route_from_grader(state: AgentState):
    """
    Pattern: Self-Correction Loop (Chapter 4) & Graceful Degradation (Chapter 16)
    """
    is_relevant = state['is_relevant']
    retries = state.get('retry_count', 0)

    if is_relevant:
        return "generate"
    elif retries < 3: # Max 3 retries
        return "increment_retry" # Go to helper node to update state
    else:
        return "end_node" # Stop looping to save tokens


def route_from_grader_with_web(state: AgentState):
    """
    Pattern: Self-Correction with Web Search Fallback
    Routes to web search after 2 failed retries instead of giving up.
    """
    is_relevant = state.get('is_relevant', False)
    retries = state.get('retry_count', 0)
    web_search_performed = state.get('web_search_performed', False)

    if is_relevant:
        return "generate"
    elif retries < 2:
        # First 2 retries: try local RAG again
        return "increment_retry"
    elif not web_search_performed:
        # After 2 retries: try web search before giving up
        print("   🌐 Local RAG exhausted. Falling back to web search...")
        return "web_search"
    else:
        # Web search also failed - graceful exit
        return "end_node"


# ═══════════════════════════════════════════════════════════════════════════════
# HITL APPROVAL NODE (Stub for Frontend Integration)
# ═══════════════════════════════════════════════════════════════════════════════

def hitl_approval_node(state: AgentState):
    """
    Pattern: Human-in-the-Loop (HITL) Checkpoint
    
    Purpose: Displays web search results and waits for user approval before 
    expensive generation. Currently auto-approves (stub behavior).
    
    Future: Will integrate with frontend to show:
    - Search results with snippets and links
    - Estimated token cost for generation
    - Approve/Reject/Edit buttons
    """
    print("--- 👤 HITL Checkpoint: Web Search Results ---")
    
    web_results = state.get('web_search_results', [])
    web_answer = state.get('web_search_answer', None)
    
    # Display what we found (for observability)
    if web_answer:
        print(f"   💡 Tavily AI Summary: {web_answer[:200]}...")
    
    print(f"   📄 Retrieved {len(web_results)} sources:")
    for i, result in enumerate(web_results[:5]):  # Show top 5
        if hasattr(result, 'title'):
            print(f"      {i+1}. {result.title[:60]}...")
            print(f"         🔗 {result.url}")
        elif isinstance(result, dict):
            print(f"      {i+1}. {result.get('title', 'No title')[:60]}...")
            print(f"         🔗 {result.get('url', 'No URL')}")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # STUB: Auto-approve for now
    # In production, this would pause and wait for frontend callback
    # ═══════════════════════════════════════════════════════════════════════════
    user_approved = True  # TODO: Replace with actual HITL mechanism
    
    if user_approved:
        print("   ✅ [STUB] Auto-approved. Proceeding to generation...")
        return {
            "hitl_approved": True,
            "hitl_message": "Auto-approved (stub mode)"
        }
    else:
        print("   ❌ User rejected web results. Stopping pipeline.")
        return {
            "hitl_approved": False,
            "hitl_message": "User rejected web search results",
            "answer": "Generation cancelled by user."
        }


def route_from_hitl(state: AgentState) -> str:
    """Routes based on HITL approval."""
    if state.get('hitl_approved', False):
        return "generate"
    return "end_node"


# In[29]:


def critic_node(state: AgentState):
    """
    Pattern: Reflection (Chapter 4) & LLM-as-a-Judge (Chapter 19)
    Decoupled Architecture with robust error handling:
    1. DeepSeek-R1: Performs deep, unstructured analysis against the rubric.
    2. Qwen-2.5/3: Extracts that analysis into a strict JSON schema for routing.
    """
    print("--- 🧐 Critic: Reviewing Draft (Decoupled Loop) ---")

    answer = state.get('answer', "")
    topic = state['topic']
    blueprint = state.get('blueprint', 'N/A')
    
    # Handle missing answer gracefully
    if not answer:
        print("   ⚠️ No answer to critique. Passing through.")
        return {
            "critique_feedback": ["No content to review"],
            "critique_praise": "N/A",
            "revision_count": state.get("revision_count", 0) + 1,
            "is_relevant": True
        }

    # Rubric based on "Technical Writer" persona (Chapter 19, Pg 311)
    rubric = """
    1. Blueprint Adherence: Does the article follow the structure defined in the Blueprint?
    2. Clarity: Are complex concepts explained using the requested 'Mental Model' analogies?
    3. Completeness: Did it use the provided context effectively?
    4. Style: Is the tone authoritative yet accessible?
    """

    # --- STEP 1: REASONING (DeepSeek-R1) ---
    llm_reasoner = ChatOllama(model="deepseek-r1:8b", temperature=0.1, num_ctx=8192)

    reasoning_prompt = f"""
    You are a Senior Technical Editor. Perform a ruthless critique of the following draft.

    [TASK]:
    1. Compare the [DRAFT] against the [BLUEPRINT] and [RUBRIC].
    2. Identify specific gaps, hallucinations, or style violations.
    3. CRITICAL: Identify 2-3 sections that are excellent and SHOULD NOT CHANGE (Positive Constraints).
    4. Determine a numerical score (0-10).

    [TOPIC]: {topic}
    [BLUEPRINT]: {blueprint}
    [RUBRIC]: {rubric}

    [DRAFT]: 
    {answer[:8000]}

    Provide your analysis step-by-step. Be specific.
    """

    # Safe invoke with fallback
    response = safe_llm_invoke(
        llm_reasoner, 
        reasoning_prompt,
        max_retries=2,
        fallback_value=create_fallback_response("Draft looks acceptable. Score: 8/10."),
        operation_name="Critic Reasoning"
    )
    raw_analysis = response.content if response else "Analysis unavailable. Defaulting to pass."

    # Visualize the Critic's thinking (Observability - Chapter 18)
    display_model_thoughts(raw_analysis)

    # --- STEP 2: FORMATTING (Qwen) ---
    llm_formatter = ChatOllama(model="qwen3:8b", format="json", temperature=0.1, num_ctx=8192)

    formatting_prompt = f"""
    You are a JSON Extractor. Extract the critique components from the analysis.

    [EDITOR ANALYSIS]:
    {raw_analysis}

    [JSON SCHEMA]:
    Return a JSON object with EXACTLY these keys:
    - "score": (integer 0-10)
    - "feedback": (string, a concise summary of *required* changes. If score >= 8, say "Looks good".)
    - "what_to_keep": (string, specific sections or paragraphs that are perfect and must be preserved)
    - "accepted": (boolean, true if score >= 8)
    """

    # Safe JSON parsing with fallback
    format_response = safe_llm_invoke(
        llm_formatter,
        formatting_prompt,
        max_retries=2,
        fallback_value=None,
        operation_name="Critic Format"
    )
    
    if format_response:
        result = safe_json_parse(
            format_response.content,
            CritiqueResponse,
            lambda: CritiqueResponse(score=8, feedback="Parsing failed, accepting.", 
                                      what_to_keep="All sections", accepted=True),
            operation_name="Critique JSON"
        )
    else:
        result = CritiqueResponse(score=8, feedback="LLM unavailable, accepting.", 
                                   what_to_keep="All sections", accepted=True)

    print(f"   📊 Score: {result.score}/10 | Accepted: {result.accepted}")

    return {
        "critique_feedback": [result.feedback],
        "critique_praise": result.what_to_keep,
        "revision_count": state.get("revision_count", 0) + 1,
        "is_relevant": result.accepted 
    }


# In[30]:


# --- 4. Routing Logic ---
def route_from_critic(state: AgentState):
    """
    Decides whether to loop back to the writer or finish.
    """
    accepted = state.get('is_relevant') # Using the bool from critic
    revisions = state.get('revision_count', 0)

    if accepted:
        print("   ✅ Critic approved. Finishing.")
        return END
    elif revisions >= 3:
        print("   ⚠️ Max revisions reached. Finishing despite critique.")
        return END
    else:
        print("   ↩️ Sending back to Writer for revision.")
        return "generate"


# In[31]:


# --- 1. The Interface (Abstraction Layer) ---
class SandboxExecutor(Protocol):
    def execute(self, code: str) -> str:
        """
        Executes code and returns the output (stdout) or error (stderr).
        """
        ...

# --- 2. Concrete Implementation (Local + Guardrails) ---
class LocalSafeExecutor:
    """
    Pattern: Tool Use Restrictions (Chapter 18, Pg 286)
    A local executor that pre-screens code for dangerous imports before running.
    """
    def __init__(self):
        self.repl = PythonREPL()
        # Blocklist of dangerous modules
        self.dangerous_modules = {'os', 'subprocess', 'sys', 'shutil', 'socket'}

    def _is_safe(self, code: str) -> Union[bool, str]:
        """
        Static Analysis Guardrail: Checks AST for dangerous imports.
        """
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                # Check 'import x'
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.split('.')[0] in self.dangerous_modules:
                            return False, f"Security Violation: Import of '{alias.name}' is forbidden."
                # Check 'from x import y'
                elif isinstance(node, ast.ImportFrom):
                    if node.module and node.module.split('.')[0] in self.dangerous_modules:
                        return False, f"Security Violation: Import from '{node.module}' is forbidden."
            return True, ""
        except SyntaxError as e:
            return False, f"Syntax Error during safety check: {e}"

    def execute(self, code: str) -> str:
        # 1. Guardrail Check
        is_safe, error_msg = self._is_safe(code)
        if not is_safe:
            print(f"   🛡️ Guardrail Blocked Execution: {error_msg}")
            return f"ERROR: {error_msg}"

        # 2. Execution (if safe)
        try:
            # PythonREPL captures stdout
            return self.repl.run(code)
        except Exception as e:
            return f"RUNTIME ERROR: {e}"

# Instantiate the tool
sandbox = LocalSafeExecutor()


# In[32]:


def code_tester_node(state: AgentState):
    """
    Pattern: Tool Use (Chapter 5) & Self-Correction (Chapter 4)
    Enhanced with robust error handling - won't crash the pipeline.
    1. Parses Python blocks from the article.
    2. Executes them in the Sandbox.
    3. If error -> Calls 'Fixer' LLM -> Replaces code in article.
    """
    print("--- 🧪 Test Engineer: Verifying Code Snippets ---")

    answer = state.get('answer', "")
    if not answer:
        print("   ⚠️ No answer to test. Skipping.")
        return {"code_execution_logs": "No content to test."}

    # Regex to find python code blocks
    code_pattern = r"```python(.*?)```"
    
    try:
        matches = list(re.finditer(code_pattern, answer, re.DOTALL))
    except Exception as e:
        print(f"   ⚠️ Regex parsing failed: {e}. Skipping code testing.")
        return {"code_execution_logs": f"Regex error: {e}"}

    if not matches:
        print("   ⚠️ No code blocks found to test.")
        return {"code_execution_logs": "No code blocks."}

    new_answer = answer
    logs = []
    failed_fixes = 0
    MAX_FIX_FAILURES = 3  # Don't let fixing loops run forever
    MAX_BLOCKS_TO_TEST = 4
    MAX_CODE_CHARS = 5000

    # Iterate in reverse order to replace text without messing up indices
    for idx, match in enumerate(reversed(matches)):
        try:
            if idx >= MAX_BLOCKS_TO_TEST:
                logs.append(f"Skipped remaining blocks after {MAX_BLOCKS_TO_TEST} checks (resource guard).")
                break

            code_block = match.group(1).strip()
            if len(code_block) > MAX_CODE_CHARS:
                logs.append(
                    f"Skipped oversized code block ({len(code_block)} chars > {MAX_CODE_CHARS} char limit)."
                )
                continue

            # 1. Execute with safe wrapper
            output = safe_code_execution(sandbox, code_block, timeout_seconds=5.0)

            # 2. Check if we should attempt a fix
            if should_attempt_fix(output, failed_fixes, MAX_FIX_FAILURES):
                print(f"   ❌ Code failed. Attempting Self-Correction...")

                # 3. The Fixing Loop with safe invoke
                llm_fixer = ChatOllama(model="qwen3:8b", temperature=0.2, num_ctx=8192)

                fix_prompt = f"""
                You are a Python Expert. The following code snippet failed to run.

                [BROKEN CODE]:
                {code_block}

                [ERROR MESSAGE]:
                {output}

                [TASK]:
                1. Analyze the error.
                2. Fix the code.
                3. Return ONLY the fixed Python code block. No explanations. No emojis.
                """

                fix_response = safe_llm_invoke(
                    llm_fixer, fix_prompt, max_retries=2,
                    fallback_value=None, operation_name="Code Fixer"
                )

                if fix_response and fix_response.content:
                    display_model_thoughts(fix_response.content)
                    fixed_code = fix_response.content.replace("```python", "").replace("```", "").strip()
                    
                    # 4. Patch the Article (State Update)
                    span = match.span(1)
                    new_answer = new_answer[:span[0]] + "\n" + fixed_code + "\n" + new_answer[span[1]:]
                    logs.append(f"Fixed: {output[:50]}...")
                    print("      ✅ Snippet patched.")
                else:
                    logs.append(f"Fix failed (no response): {output[:50]}...")
                    failed_fixes += 1

            elif "ERROR" in output or "Traceback" in output:
                # Skip unfixable errors
                logs.append(f"Skipped (unfixable): {output[:50]}...")
                print(f"      ⚠️ Skipping unfixable error.")

            else:
                print("      ✅ Snippet passed.")
                logs.append("Success.")

        except Exception as e:
            logs.append(f"Block error: {e}")
            print(f"   ⚠️ Block processing error: {e}. Continuing...")
            continue  # Don't crash, move to next block

    return {
        "answer": new_answer,  # The patched article
        "code_execution_logs": "\n".join(logs)
    }


# In[33]:


# --- 1. Initialize Graph ---
workflow = StateGraph(AgentState)

# --- 1.5 Create Guardrail and Web Search Nodes ---
content_filter = UniversalContentFilter()
guardrail_node = create_guardrail_node(content_filter)
web_search_node = create_web_search_node()

# --- 2. Add Nodes ---
# This automatically injects the logging logic into every step
workflow.add_node("guardrail", traceable(guardrail_node))  # Safety filter
workflow.add_node("dispatcher", traceable(dispatcher_node))
workflow.add_node("expander", traceable(expand_query_node))
workflow.add_node("query_plan_hitl", traceable(query_plan_hitl_node))
workflow.add_node("query_fanout", traceable(query_fanout_node))
workflow.add_node("search_worker", traceable(search_worker_node))
workflow.add_node("deduplicator", traceable(deduplicate_node))
workflow.add_node("grader", traceable(grade_documents_node))
workflow.add_node("web_search", traceable(web_search_node))  # Web search fallback
workflow.add_node("hitl_approval", traceable(hitl_approval_node))  # HITL checkpoint
workflow.add_node("generate", traceable(generate_answer_node))
workflow.add_node("code_tester", traceable(code_tester_node))
workflow.add_node("critic", traceable(critic_node))
workflow.add_node("increment_retry", traceable(increment_retry_node))

# --- 3. Define Edges ---
# Entry point is guardrail
workflow.set_entry_point("guardrail")

# Guardrail routes to dispatcher or END
workflow.add_conditional_edges("guardrail", route_from_guardrail, {
    "proceed": "dispatcher", 
    "reject": END
})

# Routing
workflow.add_conditional_edges("dispatcher", route_from_dispatcher, {"expander": "expander", "end_node": END})
workflow.add_edge("expander", "query_plan_hitl")
workflow.add_conditional_edges("query_plan_hitl", route_from_query_plan_hitl, {
    "query_fanout": "query_fanout",
    "end_node": END
})
workflow.add_conditional_edges("query_fanout", map_queries_node, ["search_worker"])

# Retrieval Loop
workflow.add_edge("search_worker", "deduplicator")
workflow.add_edge("deduplicator", "grader")

# Grader routing - adds web_search as fallback option
workflow.add_conditional_edges("grader", route_from_grader_with_web, {
    "generate": "generate", 
    "web_search": "web_search",
    "increment_retry": "increment_retry", 
    "end_node": END
})

workflow.add_edge("increment_retry", "expander")

# Web search → HITL approval → Generate (HITL checkpoint before expensive generation)
workflow.add_edge("web_search", "hitl_approval")
workflow.add_conditional_edges("hitl_approval", route_from_hitl, {
    "generate": "generate",
    "end_node": END
})

# Production Loop
workflow.add_edge("generate", "code_tester")
workflow.add_edge("code_tester", "critic")
workflow.add_conditional_edges("critic", route_from_critic, {
    "generate": "generate", 
    END: END
})

# --- 4. Compile ---
app = workflow.compile()


# ═══════════════════════════════════════════════════════════════════════════════
# GLOBAL STATE FOR BACKEND INTEGRATION
# ═══════════════════════════════════════════════════════════════════════════════

# Global vectorstore instance - set by backend before running pipeline
vectorstore = None
query_plan_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None
answer_token_stream_handler: Optional[Callable[..., None]] = None

def set_vectorstore(vs):
    """
    Set the global vectorstore for use by search_worker_node.
    Call this before invoking the pipeline when running via backend.
    """
    global vectorstore
    vectorstore = vs
    print(f"✅ Global vectorstore initialized")


def set_query_plan_hitl_handler(handler: Optional[Callable[..., Dict[str, Any]]]):
    """
    Set callback for query-plan HITL decisions.
    Expected callback result:
      {"approved": bool, "queries": List[str], "reason": str}
    """
    global query_plan_hitl_handler
    query_plan_hitl_handler = handler


def set_answer_token_stream_handler(handler: Optional[Callable[..., None]]):
    """
    Set callback to stream writer tokens to backend runner.
    Callback kwargs:
      job_id: str, token: str, done: bool, final_text: str
    """
    global answer_token_stream_handler
    answer_token_stream_handler = handler


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS FOR BACKEND INTEGRATION
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    # Graph
    "app",
    "workflow",
    "AgentState",
    # Retriever
    "build_retriever",
    "get_available_categories",
    "set_vectorstore",
    "set_query_plan_hitl_handler",
    "set_answer_token_stream_handler",
    "SOURCE_FILES",
    "DB_PATH",
    # Document Processing
    "router",
    "intelligent_chunking",
    # Nodes (for custom pipelines)
    "dispatcher_node",
    "expand_query_node",
    "query_plan_hitl_node",
    "search_worker_node",
    "deduplicate_node",
    "grade_documents_node",
    "generate_answer_node",
    "code_tester_node",
    "critic_node",
    "hitl_approval_node",
    # Routing
    "route_from_dispatcher",
    "route_from_query_plan_hitl",
    "route_from_grader_with_web",
    "route_from_critic",
    "route_from_guardrail",
    "route_from_hitl",
    # Utilities
    "tracer",
]


# In[34]:


# ═══════════════════════════════════════════════════════════════════════════════
# STANDALONE EXECUTION (only runs when script is executed directly)
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # --- INSTANTIATE DB ---
    retriever, vectorstore = build_retriever(SOURCE_FILES, "python")
    categories = get_available_categories(vectorstore)


    # In[35]:


    # --- RUN EVALUATION ---
    print(f"\n👁️ OBSERVABILITY LAYER ACTIVE. Running Trace...")
    topic = "python variables, loops and functions"
    tracer.start_trace(topic)
    # Initialize all required state keys
    inputs = {
        "topic": topic,
        "available_categories": categories,
        "retry_count": 0,
        "revision_count": 0
    }

    try:
        result = app.invoke(inputs, {"recursion_limit": 50})
        tracer.print_trajectory()
        tracer.save_trace("full_agent_trace.json")
        print("\n✅ Final Output Generation Complete.")

    except Exception as e:
        print(f"❌ Pipeline Failed: {e}")
        tracer.print_trajectory()
        tracer.save_trace("failed_agent_trace.json")


# %%

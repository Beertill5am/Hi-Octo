#!/usr/bin/env python
# coding: utf-8



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
from urllib.parse import urlparse
from datetime import datetime
from typing import Protocol, TypedDict, List, Dict, Any, Annotated, Union, Optional, Callable
from langchain_ollama import ChatOllama
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langgraph.graph import StateGraph, END
from langgraph.types import Send
from langchain_experimental.utilities import PythonREPL
from pydantic import BaseModel, Field
from IPython.display import display, HTML

# Import extensions for multi-format support, pre-flight analysis, and error handling
from agent_pipeline_extensions import (
    safe_llm_invoke,
    safe_json_parse,
    create_fallback_response,
    safe_code_execution,
    should_attempt_fix,
)
from agent_pipeline_retrieval import (
    router,
    intelligent_chunking,
    get_available_categories as _get_available_categories,
    build_retriever as _build_retriever,
)

# Import content filter and web search
from content_filter import UniversalContentFilter, create_guardrail_node, route_from_guardrail
from web_search_agent import WebSearchAgent, create_web_search_node




OLLAMA_API_KEY = os.environ["OLLAMA_API_KEY"] 




DB_PATH = "./agent_knowledge_db"
SOURCE_FILES = ["books/think_python_how_to_think_like_a_computer_scientist.epub",
               "books/python_crash_course.epub",
               "books/python_data_structures_and_algorithms.epub",
               "books/fluent_python.epub",
               "books/python_dataTypes.md"]




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


def sanitize_public_reasoning(text: str, max_chars: int = 1200) -> str:
    """
    Prepare a safe, compact rationale stream for UI transparency.
    We avoid exposing hidden/internal thinking tags verbatim.
    """
    if not text:
        return ""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    lines = [re.sub(r"\s+", " ", line).strip() for line in cleaned.splitlines()]
    cleaned = "\n".join([line for line in lines if line])
    return cleaned[:max_chars]


def chunk_text_for_stream(text: str, chunk_size: int = 180) -> List[str]:
    """Split rationale into readable chunks for incremental UI streaming."""
    if not text:
        return []
    words = text.split(" ")
    chunks: List[str] = []
    current = ""
    for w in words:
        candidate = f"{current} {w}".strip()
        if len(candidate) <= chunk_size:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = w
    if current:
        chunks.append(current)
    return chunks


def _compute_evidence_id(doc: Document) -> str:
    """Deterministic evidence id for a retrieved chunk."""
    metadata = doc.metadata or {}
    source = str(metadata.get("source") or metadata.get("title") or "")
    page_raw = metadata.get("page")
    page_val = str(page_raw) if page_raw is not None else ""
    raw = f"{source}|{page_val}|{doc.page_content or ''}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"evi_{digest}"


def _build_evidence_records(docs: List[Document]) -> List[Dict[str, Any]]:
    """Build canonical evidence records with stable ids and clean display labels."""
    records: List[Dict[str, Any]] = []
    for i, doc in enumerate(docs):
        metadata = doc.metadata or {}
        source = str(metadata.get("source") or metadata.get("title") or "Unknown source")
        source_url = str(metadata.get("source_url") or "")
        page_raw = metadata.get("page")
        page_num = (page_raw + 1) if isinstance(page_raw, int) else None
        snippet = " ".join((doc.page_content or "").split())[:360]
        full_content = (doc.page_content or "")[:1200]
        score = metadata.get("score", metadata.get("relevance_score", 0.8))
        try:
            relevance_score = float(score)
        except Exception:
            relevance_score = 0.8
        relevance_score = max(0.0, min(1.0, relevance_score))

        domain = ""
        if source_url:
            try:
                domain = urlparse(source_url).netloc
            except Exception:
                domain = ""
        if not domain:
            domain = "local-doc"

        display_index = i + 1
        records.append({
            "evidence_id": _compute_evidence_id(doc),
            "display_index": display_index,
            "display_id": f"Source #{display_index}",
            "title": source,
            "url": source_url or "",
            "snippet": snippet,
            "citation": snippet[:200],
            "page": page_num,
            "full_content": full_content,
            "relevance_score": relevance_score,
            "domain": domain,
            "word_count": len((doc.page_content or "").split()),
            "retrieved_at": datetime.now().isoformat(),
            "page_content": doc.page_content or "",
        })
    return records


def _extract_source_refs(text: str) -> List[str]:
    """Extract display ids (e.g., Source #3) from arbitrary model text."""
    if not text:
        return []
    refs = re.findall(r"\bSource\s*#\s*(\d+)\b", text, flags=re.IGNORECASE)
    return [f"Source #{int(ref)}" for ref in refs]


def _filter_reasoning_by_verified_sources(text: str, verified_sources: set[str]) -> str:
    """
    Drop lines that reference unverified sources.
    If a line references sources, all referenced sources must be verified.
    """
    if not text:
        return ""
    if not verified_sources:
        return ""
    kept: List[str] = []
    for line in text.splitlines():
        refs = _extract_source_refs(line)
        if not refs:
            kept.append(line)
            continue
        if all(ref in verified_sources for ref in refs):
            kept.append(line)
    return "\n".join(kept).strip()


def _filter_summary_lines_by_sources(text: str, allowed_sources: set[str]) -> str:
    """
    Keep only lines whose cited Source #N labels are present in allowed_sources.
    Lines with no citations are kept only if they are non-claim metadata (e.g., Coverage).
    """
    if not text:
        return ""
    kept: List[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        refs = _extract_source_refs(stripped)
        if refs:
            if all(ref in allowed_sources for ref in refs):
                kept.append(stripped)
            continue
        if stripped.lower().startswith("coverage:"):
            kept.append(stripped)
    return "\n".join(kept).strip()


def _normalize_binary_score(value: Any) -> str:
    """Normalize model grader outputs to strict yes/no."""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        return "yes" if float(value) > 0 else "no"
    text = str(value or "").strip().lower()
    if text in {"yes", "y", "true", "1", "relevant"}:
        return "yes"
    if text in {"no", "n", "false", "0", "irrelevant"}:
        return "no"
    return "no"


def _normalize_web_result_item(item: Any) -> Dict[str, Any]:
    """Normalize web search result object/dict for HITL rendering."""
    if isinstance(item, dict):
        title = item.get("title", "Untitled")
        url = item.get("url", "")
        snippet = item.get("snippet") or item.get("content") or ""
        full_content = item.get("full_content") or item.get("raw_content") or snippet
        score = item.get("relevance_score", item.get("score", 0.0))
        domain = item.get("domain", "")
        retrieved_at = item.get("retrieved_at", item.get("timestamp", ""))
    else:
        title = getattr(item, "title", "Untitled")
        url = getattr(item, "url", "")
        snippet = getattr(item, "snippet", "") or getattr(item, "content", "")
        full_content = getattr(item, "full_content", "") or getattr(item, "raw_content", "") or snippet
        score = getattr(item, "relevance_score", None)
        if score is None:
            score = getattr(item, "score", 0.0)
        domain = getattr(item, "domain", "")
        retrieved_at = getattr(item, "retrieved_at", "") or getattr(item, "timestamp", "")

    try:
        relevance_score = float(score)
    except Exception:
        relevance_score = 0.0
    relevance_score = max(0.0, min(1.0, relevance_score))

    if not domain and url:
        try:
            domain = urlparse(url).netloc
        except Exception:
            domain = ""

    snippet = str(snippet or "")
    full_content = str(full_content or snippet)
    return {
        "title": str(title or "Untitled"),
        "url": str(url or ""),
        "snippet": snippet[:320],
        "full_content": full_content[:5000],
        "relevance_score": relevance_score,
        "domain": str(domain or ""),
        "word_count": len(full_content.split()),
        "retrieved_at": str(retrieved_at or datetime.now().isoformat()),
    }


def _summarize_web_results_for_hitl(
    topic: str,
    results: List[Dict[str, Any]],
    fallback_summary: str = ""
) -> str:
    """Generate a concise web-results summary with Source #N citations."""
    if not results:
        return fallback_summary or ""

    evidence_lines: List[str] = []
    for idx, item in enumerate(results[:8], start=1):
        evidence_lines.append(
            f"[Source #{idx}] Title: {item.get('title', '')}\n"
            f"Snippet: {item.get('snippet', '')}\n"
            f"URL: {item.get('url', '')}"
        )
    evidence_blob = "\n\n".join(evidence_lines)
    llm = ChatOllama(model="qwen3:8b", temperature=0.1, num_ctx=8192, additional_kwargs={"think": False})
    prompt = f"""
    You are preparing a short review summary before answer generation.
    User topic: {topic}

    Web evidence:
    {evidence_blob}

    Requirements:
    1. Write 3-5 concise bullet points.
    2. Every bullet must include at least one citation label like [Source #2].
    3. Only use evidence provided above.
    4. End with one short line: "Coverage: ...".
    """
    try:
        text = llm.invoke(prompt).content
        return str(text or "").strip()[:1800]
    except Exception:
        return (fallback_summary or "").strip()[:1800]




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
        print(f"[TRACE] Starting trace {self.trace_id} | Topic: '{topic}'")

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
            print(f"  [ERROR] {node_name}: {entry['payload']}")
        else:
            print(f"  [OK] {node_name}: {entry['latency']}s")

    def print_trajectory(self):
        """
        Pattern: Agent Trajectories (Chapter 19, Pg 316)
        Visualizes the sequence of steps taken to reach the solution.
        """
        print(f"\n[TRAJECTORY] {self.trace_id}")
        print("="*60)
        total_time = sum(e['latency'] for e in self.events)

        for i, event in enumerate(self.events):
            tag = "OK" if event['type'] == 'execution' else "WARN"
            print(f"{i+1:02d}. [{tag}] {event['node']:<15} | {event['latency']:<6}s | {event['payload']}")

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

        print(f"[TRACE] Saved to '{filename}'")

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


def extract_json(text: str) -> str:
    """Finds the first JSON object or array in a string."""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    return match.group(0) if match else text


def get_available_categories(vectorstore: Chroma) -> List[str]:
    """Backward-compatible facade for retrieval category discovery."""
    return _get_available_categories(vectorstore)


def build_retriever(file_paths: List[str], category: str, force_skip_refinement: bool = False):
    """Backward-compatible facade for retriever construction + ingestion."""
    return _build_retriever(
        file_paths=file_paths,
        category=category,
        db_path=DB_PATH,
        force_skip_refinement=force_skip_refinement,
        display_callback=display_model_thoughts,
    )


class AgentState(TypedDict):
    topic: str
    job_id: str
    queries: List[str]
    worker_documents: Annotated[List[Document], operator.add]
    documents: List[Document]
    evidence: List[Dict[str, Any]]
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
    graded_citations: List[Dict[str, Any]]
    code_execution_logs: str
    critic_score: int


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




class CritiqueResponse(BaseModel):
    """
    Pattern: Structured Output (Chapter 1, Pg 24)
    Ensures the Critic provides actionable data, not just text.
    """
    score: int = Field(description="Quality score from 0-10")
    feedback: str = Field(description="Specific, actionable instructions for improvement")
    what_to_keep: str = Field(description="List of excellent sections that MUST NOT be modified")
    accepted: bool = Field(description="True if score >= 8, else False")




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

    print(f"  [WORKER] Searching: '{query}'")

    # Re-using your existing vectorstore logic
    results = vectorstore.similarity_search(
        query,
        k=5,
        filter={"category": category}
    )

    # Fanout accumulator key. Canonical documents are set by deduplicate_node.
    return {"worker_documents": results}




def map_queries_node(state: AgentState):
    """
    Map step: Converts the list of queries into parallel execution requests.
    """
    queries = state.get('queries', [state['topic']])
    category = state['selected_category']

    if category == "out_of_domain":
        return [] # No work to do

    print(f"[FANOUT] Dispatching {len(queries)} parallel search workers")

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
    print("[HITL] Query Plan Review checkpoint")

    queries = state.get("queries", [])
    if not queries:
        return {
            "query_plan_approved": True,
            "query_plan_message": "No expanded queries available.",
            "query_plan_rejection_reason": ""
        }

    if query_plan_hitl_handler is None:
        print("  [HITL] No query-plan handler — auto-approving.")
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
        print(f"  [HITL] Query plan approved ({len(edited_queries)} queries).")
        return {
            "queries": edited_queries,
            "query_plan_approved": True,
            "query_plan_message": "Query plan approved.",
            "query_plan_rejection_reason": ""
        }

    print("  [HITL] Query plan rejected by user.")
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
    # Reset retrieval artifacts before each fanout cycle to avoid stale leakage.
    return {"worker_documents": [], "documents": [], "evidence": [], "graded_citations": []}




def deduplicate_node(state: AgentState):
    """
    Reduce step: Cleans up the messy parallel results.
    """
    raw_docs = state.get('worker_documents', [])
    unique_contents = set()
    unique_docs = []

    for doc in raw_docs:
        if doc.page_content not in unique_contents:
            unique_contents.add(doc.page_content)
            unique_docs.append(doc)

    print(f"  [DEDUP] {len(unique_docs)} unique docs (from {len(raw_docs)} total).")
    evidence_records = _build_evidence_records(unique_docs)
    # Canonical snapshot for this attempt only.
    return {"documents": unique_docs, "worker_documents": [], "evidence": evidence_records}




def increment_retry_node(state: AgentState):
    print("  [LOOP] Incrementing retry count")
    return {"retry_count": state.get('retry_count', 0) + 1} 




class RouteDecision(BaseModel):
    """Structured Output Pattern: Decoupled Reasoning and Formatting."""
    category: str = Field(description="The matching category from the available list, or 'out_of_domain'")
    reasoning: str = Field(description="The logical justification provided by the reasoning model")

def dispatcher_node(state: AgentState):
    print("[DISPATCH] Routing query")
    topic = state['topic']
    categories = state.get('available_categories', [])

    if not categories:
        print("  [DISPATCH] No categories found in state.")
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
        print(f"  [DISPATCH] Formatting failed: {e}")
        selected = "out_of_domain"

    print(f"  [DISPATCH] Routed to: {selected}")
    return {"selected_category": selected}




def expand_query_node(state: AgentState):
    print("[EXPAND] Generating query variations")
    topic = state['topic']
    current_retry = state.get('retry_count', 0)
    selected_category = state.get('selected_category')

    # 1. Fast Exit: Out of Domain
    if selected_category == "out_of_domain":
        print("  [EXPAND] Out of domain — skipping.")
        return {"queries": []}

    # 2. Define Schema for Structured Output
    class QueryExpansion(BaseModel):
        queries: List[str] = Field(description="List of 5 search variations")

    # 3. Dynamic Prompting
    if current_retry > 0:
        print(f"  [EXPAND] Retry #{current_retry} — broadening scope.")
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
        print(f"  [EXPAND] JSON extraction failed: {e}. Using regex fallback.")
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




def retrieve_node(state: AgentState):
    print("[RETRIEVE] Dynamic retrieval")

    # 1. Get Inputs
    queries = state.get('queries', [state['topic']]) # Use the expanded queries!
    category = state['selected_category']

    # 2. Scope Guardrail
    if category == "out_of_domain":
        print("  [RETRIEVE] Out of domain — skipping.")
        return {"documents": []}

    print(f"  [RETRIEVE] Searching {len(queries)} queries in '{category}'")

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

    print(f"  [RETRIEVE] {len(unique_docs)} unique chunks (from {len(all_docs)} total)")

    return {"documents": unique_docs}




def grade_documents_node(state: AgentState):
    """
    Pattern: Dual-Model Guardrail (Gate)
    1. DeepSeek-R1: Reasons if the content is relevant.
    2. Qwen: Extracts the binary 'yes'/'no' decision.
    """
    print("[GRADE] Verifying relevance")
    topic = state['topic']
    docs = state.get('documents', [])
    evidence = state.get('evidence', []) or _build_evidence_records(docs)

    # Context Enrichment
    doc_txt_list = []
    for item in evidence:
        source = item.get("title", "Unknown")
        page = item.get("page")
        page_text = page if page is not None else "Unknown"
        display_id = item.get("display_id", "")
        stable_id = item.get("evidence_id", "")
        content = item.get("page_content", "")

        # The stamped format the LLM will see
        entry = f"""
        [{display_id}]
        Stable ID: {stable_id}
        File: {source}
        Page: {page_text}
        Content: {content}
        -------------------------------------------
        """
        doc_txt_list.append(entry)

    # Slice this for safety
    doc_txt = "\n".join(doc_txt_list)

    # 1. Define Schema
    class Grade(BaseModel):
        binary_score: Union[str, int, float, bool] = Field(description="Relevance score convertible to yes/no")
        cited_sources: List[str] = Field(default_factory=list, description="List of cited source labels like 'Source #1'")

    # 2. Reasoning (DeepSeek-R1)
    llm_reasoning = ChatOllama(model="deepseek-r1:8b", temperature=0.1, num_ctx=8192)
    prompt_reasoning = f"""
    User Topic: {topic}
    Retrieved Snippets:
    {doc_txt}

    Task: 
    1. Analyze if the snippets contain a definition or explanation of the topic.
    2. If relevant, YOU MUST CITE source labels exactly in this format: Source #N.
    3. Ignore bibliographies or random, unrelated code.
    4. Think step-by-step: Does this content explicitly address '{topic}'?
    """
    reasoning_content = llm_reasoning.invoke(prompt_reasoning).content
    display_model_thoughts(reasoning_content)

    # 3. Formatting (Qwen)
    llm_formatter = ChatOllama(model="qwen3:8b", format="json", temperature=0.2, num_ctx=8192, 
                               additional_kwargs={"think": False})

    prompt_formatting = [
        {"role": "system", "content": "You are a grader. Output JSON with keys 'binary_score' and 'cited_sources'. 'cited_sources' must be an array of labels like 'Source #1'."},
        {"role": "user", "content": f"Based on this analysis, is the content relevant?\n\nAnalysis: {reasoning_content}"}
    ]

    verified_display_ids: List[str] = []
    verified_citations: List[Dict[str, Any]] = []
    try:
        result = llm_formatter.invoke(prompt_formatting).content
        grade = Grade.model_validate_json(extract_json(result))
        normalized_score = _normalize_binary_score(grade.binary_score)
        is_relevant = normalized_score == "yes"
        allowed_display_ids = {item.get("display_id", "") for item in evidence}
        proposed_ids = list(dict.fromkeys(_extract_source_refs(" ".join(grade.cited_sources))))
        verified_display_ids = [sid for sid in proposed_ids if sid in allowed_display_ids]
        verified_citations = _build_retrieval_citations(evidence, set(verified_display_ids))
        if is_relevant and not verified_citations:
            # Prevent mismatch: relevance without any verified citation is treated as not relevant.
            is_relevant = False
    except Exception as e:
        print(f"  [GRADE] Format error: {e}. Defaulting to not relevant.")
        is_relevant = False
        verified_display_ids = []
        verified_citations = []

    # Stream sanitized, citation-validated grader rationale to UI.
    if grader_stream_handler is not None:
        try:
            public_reasoning = sanitize_public_reasoning(reasoning_content)
            public_reasoning = _filter_reasoning_by_verified_sources(public_reasoning, set(verified_display_ids))
            if not public_reasoning and is_relevant:
                public_reasoning = "Relevant evidence validated."
            for idx, chunk in enumerate(chunk_text_for_stream(public_reasoning), start=1):
                grader_stream_handler(
                    job_id=state.get("job_id", ""),
                    text=chunk,
                    phase="grading",
                    done=False,
                    meta={"chunk": idx}
                )
        except Exception as e:
            print(f"  [GRADE] Stream warning: {e}")

    if is_relevant:
        print("  [GRADE] Content is relevant.")
    else:
        print("  [GRADE] Content is not relevant.")

    if grader_stream_handler is not None:
        try:
            grader_stream_handler(
                job_id=state.get("job_id", ""),
                text=f"Decision: {'Relevant' if is_relevant else 'Not relevant'}.",
                phase="grading",
                done=True,
                meta={
                    "is_relevant": is_relevant,
                    "docs_total": len(docs),
                    "verified_source_ids": verified_display_ids,
                    "verified_citations": verified_citations,
                }
            )
        except Exception as e:
            print(f"  [GRADE] Final stream warning: {e}")

    return {"is_relevant": is_relevant, "graded_citations": verified_citations, "evidence": evidence}




def generate_answer_node(state: AgentState):
    print("[GENERATE] Writing answer")

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
        print("  [GENERATE] Phase 1: Analyzing and blueprinting")

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
        if grader_stream_handler is not None:
            try:
                public_reasoning = sanitize_public_reasoning(str(raw_plan or ""), max_chars=5000)
                for idx, chunk in enumerate(chunk_text_for_stream(public_reasoning, chunk_size=220), start=1):
                    grader_stream_handler(
                        job_id=state.get("job_id", ""),
                        text=chunk,
                        phase="reasoning",
                        done=False,
                        meta={"chunk": idx, "replace": idx == 1},
                    )
                grader_stream_handler(
                    job_id=state.get("job_id", ""),
                    text="Reasoning phase complete. Awaiting review checkpoint.",
                    phase="reasoning",
                    done=True,
                    meta={"replace": False},
                )
            except Exception as e:
                print(f"  [GENERATE] Reasoning stream warning: {e}")

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

        review_sources: List[Dict[str, Any]] = list(state.get("graded_citations", []) or [])
        if not review_sources:
            web_results = state.get("web_search_results", []) or []
            normalized_results: List[Dict[str, Any]] = []
            for idx, result in enumerate(web_results[:10], start=1):
                item = _normalize_web_result_item(result)
                item["source_id"] = f"Source #{idx}"
                normalized_results.append(item)
            review_sources = normalized_results

        if reasoning_hitl_handler is None:
            print("  [HITL] No reasoning HITL handler — auto-approving.")
        else:
            decision = reasoning_hitl_handler(
                job_id=state.get("job_id", ""),
                topic=state.get("topic", ""),
                selected_category=state.get("selected_category", ""),
                reasoning_text=str(raw_plan or ""),
                editable_text=str(current_blueprint or ""),
                search_results=review_sources,
            ) or {}
            approved = bool(decision.get("approved", True))
            reason = str(decision.get("reason", ""))
            edited_text = str(decision.get("edited_text", "") or "").strip()

            if not approved:
                print("  [HITL] Reasoning review rejected.")
                return {
                    "hitl_approved": False,
                    "hitl_message": reason or "User rejected reasoning review.",
                    "answer": "Generation cancelled because reasoning review was rejected.",
                }

            if edited_text:
                print("  [HITL] Applying user-edited reasoning blueprint.")
                current_blueprint = edited_text

        # --- C. BLUEPRINT HITL CHECKPOINT ---
        if blueprint_hitl_handler is None:
            print("  [HITL] No blueprint HITL handler — auto-approving.")
        else:
            bp_decision = blueprint_hitl_handler(
                job_id=state.get("job_id", ""),
                topic=state.get("topic", ""),
                selected_category=state.get("selected_category", ""),
                reasoning_text=str(raw_plan or ""),
                blueprint_text=str(current_blueprint or ""),
                editable_text=str(current_blueprint or ""),
            ) or {}
            bp_approved = bool(bp_decision.get("approved", True))
            bp_reason = str(bp_decision.get("reason", ""))
            bp_edited = str(bp_decision.get("edited_text", "") or "").strip()

            if not bp_approved:
                print("  [HITL] Blueprint review rejected.")
                return {
                    "hitl_approved": False,
                    "hitl_message": bp_reason or "User rejected blueprint review.",
                    "answer": "Generation cancelled because blueprint review was rejected.",
                }

            if bp_edited:
                print("  [HITL] Applying user-edited blueprint.")
                current_blueprint = bp_edited

    else:
        print(f"  [GENERATE] Revision #{revision_count}: Reusing existing blueprint.")

    # ============================================================
    # PHASE 2: WRITING / REFINING (Iterative)
    # ============================================================

    llm_writer = ChatOllama(model="gpt-oss:120b-cloud", temperature=0.7, num_ctx=64000) 

    # --- Branch A: First Draft ---
    if revision_count == 0:
        print("  [GENERATE] Phase 2: Writing initial draft")
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
        print(f"  [GENERATE] Phase 2: Refining draft (feedback-driven)")
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
        return "retrieval_hitl"
    elif retries < 2:
        # First 2 retries: try local RAG again
        return "increment_retry"
    elif not web_search_performed:
        # After 2 retries: ask user approval before web search.
        print("  [ROUTE] Local RAG exhausted — requesting web search approval.")
        return "web_search_intent_hitl"
    else:
        # Web search also failed - graceful exit
        return "end_node"


# HITL APPROVAL NODE (Stub for Frontend Integration)

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
    print("[HITL] Web Search Results review")
    
    web_results = state.get('web_search_results', [])
    web_answer = state.get('web_search_answer', None)
    normalized_results = []
    for idx, result in enumerate((web_results or []), start=1):
        item = _normalize_web_result_item(result)
        item["source_id"] = f"Source #{idx}"
        normalized_results.append(item)
    ai_summary = _summarize_web_results_for_hitl(
        topic=state.get("topic", ""),
        results=normalized_results,
        fallback_summary=str(web_answer or "")
    )
    allowed_sources = {item.get("source_id", "") for item in normalized_results}
    ai_summary = _filter_summary_lines_by_sources(ai_summary, allowed_sources)
    
    # Display what we found (for observability)
    if web_answer:
        print(f"  [HITL] AI Summary: {web_answer[:200]}...")
    
    print(f"  [HITL] Retrieved {len(web_results)} sources")
    for i, result in enumerate(web_results[:5]):  # Show top 5
        if hasattr(result, 'title'):
            print(f"      {i+1}. {result.title[:60]}...")
            print(f"         🔗 {result.url}")
        elif isinstance(result, dict):
            print(f"      {i+1}. {result.get('title', 'No title')[:60]}")
            print(f"         🔗 {result.get('url', 'No URL')}")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # STUB: Auto-approve for now
    # In production, this would pause and wait for frontend callback
    # ═══════════════════════════════════════════════════════════════════════════
    if web_hitl_handler is None:
        print("  [HITL] No web HITL handler — auto-approving.")
        return {
            "hitl_approved": True,
            "hitl_message": "Auto-approved (no web HITL handler)."
        }

    decision = web_hitl_handler(
        job_id=state.get("job_id", ""),
        topic=state.get("topic", ""),
        selected_category=state.get("selected_category", ""),
        phase="post_web_search",
        results=normalized_results,
        ai_summary=ai_summary
    ) or {}
    approved = bool(decision.get("approved", True))
    reason = str(decision.get("reason", ""))

    if approved:
        print("  [HITL] Web search results approved.")
        return {
            "hitl_approved": True,
            "hitl_message": "Approved web search results."
        }

    print("  [HITL] User rejected web results.")
    return {
        "hitl_approved": False,
        "hitl_message": reason or "User rejected web search results",
        "answer": "Generation cancelled by user."
    }


def web_search_intent_hitl_node(state: AgentState):
    """
    HITL checkpoint before executing web search fallback.
    Requires explicit user approval to run external search.
    """
    print("[HITL] Pre-Web-Search Approval checkpoint")

    if web_hitl_handler is None:
        print("  [HITL] No web HITL handler — auto-approving pre-search.")
        return {
            "hitl_approved": True,
            "hitl_message": "Auto-approved (no web HITL handler)."
        }

    decision = web_hitl_handler(
        job_id=state.get("job_id", ""),
        topic=state.get("topic", ""),
        selected_category=state.get("selected_category", ""),
        phase="pre_web_search",
        results=[]
    ) or {}
    approved = bool(decision.get("approved", True))
    reason = str(decision.get("reason", ""))

    if approved:
        print("  [HITL] Web search approved.")
        return {
            "hitl_approved": True,
            "hitl_message": "Approved web search execution."
        }

    print("  [HITL] Web search rejected by user.")
    return {
        "hitl_approved": False,
        "hitl_message": reason or "User rejected web search execution.",
        "answer": "Generation cancelled because web search was rejected before execution."
    }


def route_from_hitl(state: AgentState) -> str:
    """Routes based on HITL approval."""
    if state.get('hitl_approved', False):
        return "generate"
    return "end_node"


def route_from_generate(state: AgentState) -> str:
    """Route after generation; stop if reasoning HITL rejected."""
    if state.get("hitl_approved") is False:
        return END
    return "code_tester"


def route_from_web_intent_hitl(state: AgentState) -> str:
    """Routes pre-web-search HITL decision."""
    if state.get('hitl_approved', False):
        return "web_search"
    return "end_node"


def _build_retrieval_citations(
    evidence_records: List[Dict[str, Any]],
    allowed_display_ids: Optional[set[str]] = None
) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    for item in evidence_records:
        display_id = str(item.get("display_id", ""))
        if allowed_display_ids is not None and display_id not in allowed_display_ids:
            continue
        citations.append({
            "source_id": display_id,
            "evidence_id": item.get("evidence_id", ""),
            "title": item.get("title", "Unknown source"),
            "url": item.get("url", ""),
            "snippet": item.get("snippet", ""),
            "citation": item.get("citation", ""),
            "page": item.get("page"),
            "full_content": item.get("full_content", ""),
            "relevance_score": item.get("relevance_score", 0.8),
            "domain": item.get("domain", "local-doc"),
            "word_count": item.get("word_count", 0),
            "retrieved_at": item.get("retrieved_at", datetime.now().isoformat()),
        })
    return citations


def retrieval_hitl_node(state: AgentState):
    """
    HITL checkpoint after grader marks local retrieval as relevant.
    User must approve/reject the citation set before generation.
    """
    print("[HITL] Retrieval Citation Review checkpoint")
    citations = state.get("graded_citations", [])
    if not citations:
        evidence = state.get("evidence", []) or _build_evidence_records(state.get("documents", []))
        citations = _build_retrieval_citations(evidence)

    if not citations:
        return {
            "hitl_approved": False,
            "hitl_message": "No citations available for approval.",
            "answer": "I couldn't find reviewable citations to proceed."
        }

    if retrieval_hitl_handler is None:
        print("  [HITL] No retrieval HITL handler — auto-approving.")
        return {
            "graded_citations": citations,
            "hitl_approved": True,
            "hitl_message": "Auto-approved (no retrieval HITL handler)."
        }

    decision = retrieval_hitl_handler(
        job_id=state.get("job_id", ""),
        topic=state.get("topic", ""),
        selected_category=state.get("selected_category", ""),
        citations=citations
    ) or {}
    approved = bool(decision.get("approved", True))
    reason = str(decision.get("reason", ""))

    if approved:
        print("  [HITL] Retrieval citations approved.")
        return {
            "graded_citations": citations,
            "hitl_approved": True,
            "hitl_message": "Approved retrieval citations."
        }

    print("  [HITL] Retrieval citations rejected.")
    return {
        "graded_citations": citations,
        "hitl_approved": False,
        "hitl_message": reason or "User rejected retrieval citations.",
        "answer": "Generation cancelled because citation set was rejected."
    }




def critic_node(state: AgentState):
    """
    Pattern: Reflection (Chapter 4) & LLM-as-a-Judge (Chapter 19)
    Decoupled Architecture with robust error handling:
    1. DeepSeek-R1: Performs deep, unstructured analysis against the rubric.
    2. Qwen-2.5/3: Extracts that analysis into a strict JSON schema for routing.
    """
    print("[CRITIC] Reviewing draft quality")

    answer = state.get('answer', "")
    topic = state['topic']
    blueprint = state.get('blueprint', 'N/A')
    
    # Handle missing answer gracefully
    if not answer:
        print("  [CRITIC] No answer to critique — passing through.")
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

    print(f"  [CRITIC] Score: {result.score}/10 | Accepted: {result.accepted}")

    # Emit critic summary to frontend (visible on BOTH approval & rejection paths)
    if grader_stream_handler:
        try:
            grader_stream_handler(
                job_id=state["job_id"],
                text="",
                phase="critic_summary",
                done=True,
                meta={
                    "replace": True,
                    "critic_score": result.score,
                    "critic_accepted": result.accepted,
                    "critic_feedback": result.feedback,
                    "critic_praise": result.what_to_keep,
                    "code_execution_logs": state.get("code_execution_logs", ""),
                    "iteration_count": state.get("revision_count", 0),
                }
            )
        except Exception as e:
            print(f"  [CRITIC] Failed to emit summary: {e}")

    return {
        "critique_feedback": [result.feedback],
        "critique_praise": result.what_to_keep,
        "revision_count": state.get("revision_count", 0) + 1,
        "is_relevant": result.accepted,
        "critic_score": result.score
    }



def draft_review_hitl_node(state: AgentState):
    """
    HITL checkpoint after Critic rejects a draft.
    Shows the user the current draft, critic feedback, score, and code logs
    so they can review, edit, or override before the Writer regenerates.
    """
    print("[HITL] Draft Review checkpoint")

    answer = state.get("answer", "")
    feedback = state.get("critique_feedback", [])
    praise = state.get("critique_praise", "")
    revision_count = state.get("revision_count", 0)
    code_logs = state.get("code_execution_logs", "")

    # Derive a score from the feedback text (critic returns it in state)
    # The critic node sets is_relevant=False when score < 8, so we can
    # infer a rough score. For transparency we'll pass the raw feedback.
    # Read the score from state (set by critic node)
    critic_score = state.get("critic_score", None)

    if draft_hitl_handler is None:
        print("  [HITL] No draft HITL handler — auto-approving.")
        return {
            "hitl_approved": True,
            "hitl_message": "Auto-approved (no draft HITL handler).",
        }

    decision = draft_hitl_handler(
        job_id=state.get("job_id", ""),
        topic=state.get("topic", ""),
        current_draft=answer,
        critic_feedback=feedback,
        critic_praise=praise,
        critic_score=critic_score,
        code_execution_logs=code_logs,
        iteration_count=revision_count,
    ) or {}

    approved = bool(decision.get("approved", True))
    reason = str(decision.get("reason", ""))
    edited_draft = str(decision.get("edited_text", "") or "").strip()
    edited_feedback = decision.get("edited_feedback")

    if not approved:
        # User chose "Keep as Final" or rejected further iteration
        print("  [HITL] User accepted current draft as final.")
        return {
            "hitl_approved": False,
            "hitl_message": reason or "User accepted current draft as final.",
            "is_relevant": True,  # Override critic - mark as accepted
        }

    # User wants another revision
    updates: Dict[str, Any] = {
        "hitl_approved": True,
        "hitl_message": "Draft review approved. Sending to writer for revision.",
    }
    if edited_draft:
        print("  [HITL] Applying user-edited draft.")
        updates["answer"] = edited_draft
    if edited_feedback:
        print("  [HITL] Applying user-edited feedback.")
        updates["critique_feedback"] = edited_feedback if isinstance(edited_feedback, list) else [edited_feedback]

    return updates


def route_from_draft_hitl(state: AgentState) -> str:
    """Routes after draft review HITL checkpoint."""
    if state.get("hitl_approved", False):
        return "generate"
    return END


# --- 4. Routing Logic ---
def route_from_critic(state: AgentState):
    """
    Decides whether to loop back to the writer or finish.
    Now routes rejected drafts through the draft_review_hitl checkpoint.
    """
    accepted = state.get('is_relevant')  # Using the bool from critic
    revisions = state.get('revision_count', 0)

    if accepted:
        print("  [CRITIC] Approved. Finishing.")
        return END
    elif revisions >= 3:
        print("  [CRITIC] Max revisions reached. Finishing.")
        return END
    else:
        print("  [CRITIC] Sending to draft review HITL.")
        return "draft_review_hitl"




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
            print(f"  [SANDBOX] Blocked: {error_msg}")
            return f"ERROR: {error_msg}"

        # 2. Execution (if safe)
        try:
            # PythonREPL captures stdout
            return self.repl.run(code)
        except Exception as e:
            return f"RUNTIME ERROR: {e}"

# Instantiate the tool
sandbox = LocalSafeExecutor()




def code_tester_node(state: AgentState):
    """
    Pattern: Tool Use (Chapter 5) & Self-Correction (Chapter 4)
    Enhanced with robust error handling - won't crash the pipeline.
    1. Parses Python blocks from the article.
    2. Executes them in the Sandbox.
    3. If error -> Calls 'Fixer' LLM -> Replaces code in article.
    """
    print("[CODE_TEST] Verifying code snippets")

    answer = state.get('answer', "")
    if not answer:
        print("  [CODE_TEST] No answer to test — skipping.")
        return {"code_execution_logs": "No content to test."}

    # Regex to find python code blocks
    code_pattern = r"```python(.*?)```"
    
    try:
        matches = list(re.finditer(code_pattern, answer, re.DOTALL))
    except Exception as e:
        print(f"  [CODE_TEST] Regex parsing failed: {e}. Skipping.")
        return {"code_execution_logs": f"Regex error: {e}"}

    if not matches:
        print("  [CODE_TEST] No code blocks found.")
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
                print("  [CODE_TEST] Code failed — attempting self-correction.")

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
workflow.add_node("retrieval_hitl", traceable(retrieval_hitl_node))
workflow.add_node("web_search_intent_hitl", traceable(web_search_intent_hitl_node))
workflow.add_node("web_search", traceable(web_search_node))  # Web search fallback
workflow.add_node("hitl_approval", traceable(hitl_approval_node))  # HITL checkpoint
workflow.add_node("generate", traceable(generate_answer_node))
workflow.add_node("code_tester", traceable(code_tester_node))
workflow.add_node("critic", traceable(critic_node))
workflow.add_node("draft_review_hitl", traceable(draft_review_hitl_node))
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
    "retrieval_hitl": "retrieval_hitl",
    "web_search_intent_hitl": "web_search_intent_hitl",
    "increment_retry": "increment_retry", 
    "end_node": END
})
workflow.add_conditional_edges("web_search_intent_hitl", route_from_web_intent_hitl, {
    "web_search": "web_search",
    "end_node": END
})
workflow.add_conditional_edges("retrieval_hitl", route_from_hitl, {
    "generate": "generate",
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
workflow.add_conditional_edges("generate", route_from_generate, {
    "code_tester": "code_tester",
    END: END,
})
workflow.add_edge("code_tester", "critic")
workflow.add_conditional_edges("critic", route_from_critic, {
    "draft_review_hitl": "draft_review_hitl",
    END: END
})
workflow.add_conditional_edges("draft_review_hitl", route_from_draft_hitl, {
    "generate": "generate",
    END: END
})

# --- 4. Compile ---
app = workflow.compile()


# GLOBAL STATE FOR BACKEND INTEGRATION

# Global vectorstore instance - set by backend before running pipeline
vectorstore = None
query_plan_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None
answer_token_stream_handler: Optional[Callable[..., None]] = None
retrieval_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None
reasoning_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None
blueprint_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None
grader_stream_handler: Optional[Callable[..., None]] = None
web_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None
draft_hitl_handler: Optional[Callable[..., Dict[str, Any]]] = None

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


def set_retrieval_hitl_handler(handler: Optional[Callable[..., Dict[str, Any]]]):
    """
    Set callback for post-grader retrieval citation approval.
    Expected callback result:
      {"approved": bool, "reason": str}
    """
    global retrieval_hitl_handler
    retrieval_hitl_handler = handler


def set_reasoning_hitl_handler(handler: Optional[Callable[..., Dict[str, Any]]]):
    """
    Set callback for post-reasoning review checkpoint.
    Expected callback result:
      {"approved": bool, "reason": str, "edited_text": str}
    """
    global reasoning_hitl_handler
    reasoning_hitl_handler = handler


def set_blueprint_hitl_handler(handler: Optional[Callable[..., Dict[str, Any]]]):
    """
    Set callback for post-blueprint review checkpoint.
    Expected callback result:
      {"approved": bool, "reason": str, "edited_text": str}
    """
    global blueprint_hitl_handler
    blueprint_hitl_handler = handler


def set_grader_stream_handler(handler: Optional[Callable[..., None]]):
    """
    Set callback to stream sanitized grader rationale.
    Callback kwargs:
      job_id: str, text: str, phase: str, done: bool, meta: dict
    """
    global grader_stream_handler
    grader_stream_handler = handler


def set_web_hitl_handler(handler: Optional[Callable[..., Dict[str, Any]]]):
    """
    Set callback for web-search HITL decisions.
    Expected callback result:
      {"approved": bool, "reason": str}
    """
    global web_hitl_handler
    web_hitl_handler = handler


def set_draft_hitl_handler(handler: Optional[Callable[..., Dict[str, Any]]]):
    """
    Set callback for draft-review HITL decisions.
    Expected callback result:
      {"approved": bool, "reason": str, "edited_text": str, "edited_feedback": list|str}
    """
    global draft_hitl_handler
    draft_hitl_handler = handler


# EXPORTS FOR BACKEND INTEGRATION

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
    "set_retrieval_hitl_handler",
    "set_reasoning_hitl_handler",
    "set_blueprint_hitl_handler",
    "set_grader_stream_handler",
    "set_web_hitl_handler",
    "set_draft_hitl_handler",
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
    "retrieval_hitl_node",
    "web_search_intent_hitl_node",
    "generate_answer_node",
    "code_tester_node",
    "critic_node",
    "hitl_approval_node",
    # Routing
    "route_from_dispatcher",
    "route_from_query_plan_hitl",
    "route_from_grader_with_web",
    "route_from_critic",
    "route_from_draft_hitl",
    "draft_review_hitl_node",
    "route_from_guardrail",
    "route_from_hitl",
    "route_from_web_intent_hitl",
    # Utilities
    "tracer",
]






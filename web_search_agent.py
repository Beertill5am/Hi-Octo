"""
Web Search Agent Module
=======================
Web search capability using Tavily API (optimized for LLM applications).

Usage:
    from web_search_agent import WebSearchTool, web_search_node
    
    tool = WebSearchTool(api_key="your-tavily-api-key")
    results = tool.search("Python decorators tutorial")
"""

import os
import time
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from tavily import TavilyClient
from content_filter import UniversalContentFilter
from urllib.parse import urlparse

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")


def extract_domain(url: str) -> str:
    """Extract clean domain from URL (e.g., 'python.org' from 'https://docs.python.org/3/...')."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove www. prefix
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except Exception:
        return "unknown"

@dataclass
class SearchResult:
    """A single search result."""
    title: str
    url: str
    content: str
    score: float = 0.0
    source: str = "tavily"
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    raw_content: Optional[str] = None  # Full page content if available
    
    def to_document_dict(self) -> Dict[str, Any]:
        """Convert to LangChain Document-compatible format."""
        return {
            "page_content": f"{self.title}\n\n{self.content}",
            "metadata": {
                "source": self.url,
                "title": self.title,
                "type": "web_search",
                "score": self.score,
                "retrieved_at": self.timestamp
            }
        }


class WebSearchTool:
    """
    Web search tool using Tavily API.
    
    Features:
    - Optimized for LLM/AI applications
    - Returns relevant snippets (not just links)
    - Optional full page content retrieval
    - Content filtering integration
    - Result caching
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        max_results: int = 10,  # 10 results for inline display
        search_depth: str = "basic",  # "basic" or "advanced"
        include_answer: bool = True,
        include_raw_content: bool = True,  # Enable for HITL content preview
    ):
        """
        Initialize Tavily search tool.
        
        Args:
            api_key: Tavily API key (or set TAVILY_API_KEY env var)
            max_results: Number of results to return
            search_depth: "basic" (fast) or "advanced" (comprehensive)
            include_answer: Get AI-generated answer summary
            include_raw_content: Include full page content (slower)
        """
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        self.max_results = max_results
        self.search_depth = search_depth
        self.include_answer = include_answer
        self.include_raw_content = include_raw_content
        self.content_filter = UniversalContentFilter()
        self._cache: Dict[str, Dict] = {}
        self._client = None
        self._client = TavilyClient(api_key=self.api_key)
    
    def search(self, query: str, num_results: Optional[int] = None) -> Dict[str, Any]:
        """
        Perform a web search.
        
        Args:
            query: Search query
            num_results: Override default max_results
            
        Returns:
            Dict with 'results' (List[SearchResult]) and optional 'answer'
        """
        if not self._client:
            print("❌ Tavily API key not configured. Set TAVILY_API_KEY env var.")
            return {"results": [], "answer": None}
        
        # Safety check
        filter_result = self.content_filter.check(query)
        if not filter_result.is_safe:
            print(f"🛡️ Search blocked: {filter_result.reason}")
            return {"results": [], "answer": None, "blocked": True}
        
        # Check cache
        cache_key = f"{query}:{num_results or self.max_results}:{self.search_depth}"
        if cache_key in self._cache:
            print(f"📦 Cache hit for: {query[:50]}...")
            return self._cache[cache_key]
        
        results = []
        answer = None
        limit = num_results or self.max_results
        
        try:
            print(f"🔍 Tavily Search: {query[:50]}...")
            
            response = self._client.search(
                query=query,
                search_depth=self.search_depth,
                max_results=limit,
                include_answer=self.include_answer,
                include_raw_content=self.include_raw_content,
            )
            
            # Extract answer if available
            answer = response.get('answer')
            if answer:
                print(f"   💡 AI Answer: {answer[:100]}...")
            
            # Extract results
            for item in response.get('results', []):
                result = SearchResult(
                    title=item.get('title', 'No Title'),
                    url=item.get('url', ''),
                    content=item.get('content', ''),
                    score=item.get('score', 0.0),
                    raw_content=item.get('raw_content')
                )
                results.append(result)
            
            print(f"   ✅ Found {len(results)} results")
            
            # Cache results
            output = {"results": results, "answer": answer}
            self._cache[cache_key] = output
            return output
            
        except Exception as e:
            print(f"   ❌ Search error: {e}")
            return {"results": [], "answer": None, "error": str(e)}
    
    def search_as_documents(self, query: str, num_results: Optional[int] = None) -> List[Dict]:
        """Search and return results as Document-compatible dicts."""
        response = self.search(query, num_results)
        return [r.to_document_dict() for r in response.get('results', [])]
    
    def quick_answer(self, query: str) -> Optional[str]:
        """Get just the AI-generated answer (fastest)."""
        response = self.search(query, num_results=1)
        return response.get('answer')
    
    def clear_cache(self):
        """Clear the search cache."""
        self._cache.clear()


class WebSearchAgent:
    """
    Agent that decides when and how to search the web.
    Integrates with the existing RAG pipeline.
    """
    
    def __init__(
        self,
        search_tool: Optional[WebSearchTool] = None,
        llm=None,
        max_search_queries: int = 3,
        api_key: Optional[str] = None
    ):
        self.search_tool = search_tool or WebSearchTool(api_key=api_key)
        self.llm = llm
        self.max_search_queries = max_search_queries
    
    def should_search_web(self, state: Dict[str, Any]) -> bool:
        """
        Determine if web search should be triggered.
        
        Triggers:
        1. Category is "out_of_domain"
        2. Local search returned no relevant results after retries
        3. Query explicitly asks for "latest" or "current" info
        """
        # Check for out_of_domain
        if state.get('selected_category') == 'out_of_domain':
            return True
        
        # Check for retry exhaustion
        if state.get('retry_count', 0) >= 2 and not state.get('is_relevant', True):
            return True
        
        # Check for recency keywords
        query = state.get('topic', '').lower()
        recency_keywords = ['latest', 'current', 'recent', '2024', '2025', '2026', 'new', 'today', 'now']
        if any(kw in query for kw in recency_keywords):
            return True
        
        return False
    
    def expand_query(self, query: str) -> List[str]:
        """Expand a single query into multiple search queries."""
        if not self.llm:
            return [query]
        
        try:
            prompt = f"""Generate {self.max_search_queries} search queries to find information about:
"{query}"

Return ONLY the queries, one per line. No numbering or bullets."""
            
            response = self.llm.invoke(prompt).content
            queries = [q.strip() for q in response.strip().split('\n') if q.strip()]
            return queries[:self.max_search_queries] or [query]
        except Exception:
            return [query]
    
    def search(self, query: str, expand: bool = False) -> Dict[str, Any]:
        """
        Perform web search.
        
        Args:
            query: The search query
            expand: Whether to expand into multiple queries
            
        Returns:
            Dict with 'documents', 'answer', and metadata
        """
        if expand:
            queries = self.expand_query(query)
        else:
            queries = [query]
        
        all_results = []
        seen_urls = set()
        answer = None
        
        for i, q in enumerate(queries):
            response = self.search_tool.search(q)
            
            # Keep first answer
            if not answer and response.get('answer'):
                answer = response.get('answer')
            
            for result in response.get('results', []):
                if result.url not in seen_urls:
                    seen_urls.add(result.url)
                    all_results.append(result)
        
        return {
            "results": all_results,
            "documents": [r.to_document_dict() for r in all_results],
            "answer": answer,
            "query_count": len(queries)
        }


# ═══════════════════════════════════════════════════════════════════════════════
# LANGGRAPH NODE FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def create_web_search_node(api_key: Optional[str] = None, search_agent: Optional[WebSearchAgent] = None):
    """
    Factory to create a web search node for LangGraph.
    
    Usage:
        web_search_node = create_web_search_node(api_key="tvly-xxx")
        graph.add_node("web_search", web_search_node)
    """
    agent = search_agent or WebSearchAgent(api_key=api_key)
    
    def web_search_node(state: dict) -> dict:
        """LangGraph node that performs web search."""
        print("--- 🌐 Web Search Agent: Searching with Tavily ---")
        
        query = state.get('topic', '')
        
        if not query:
            return {
                "web_search_results": [],
                "web_search_performed": True,
                "web_search_message": "No query provided"
            }
        
        # Perform search
        response = agent.search(query, expand=False)
        
        # Convert to Document format
        from langchain_core.documents import Document
        documents = [
            Document(
                page_content=r['page_content'],
                metadata=r['metadata']
            )
            for r in response.get('documents', [])
        ]
        
        answer = response.get('answer')
        
        print(f"   ✅ Retrieved {len(documents)} web results")
        if answer:
            print(f"   💡 Quick answer available")
        
        return {
            "documents": documents,
            "web_search_results": response.get('results', []),
            "web_search_answer": answer,
            "web_search_performed": True,
            "web_search_message": f"Found {len(documents)} web results"
        }
    
    return web_search_node


def route_to_web_search(state: dict) -> str:
    """
    Routing function to decide if web search is needed.
    
    Usage:
        graph.add_conditional_edges(
            "grader",
            route_to_web_search,
            {"web_search": "web_search", "generate": "generate"}
        )
    """
    agent = WebSearchAgent()
    
    if agent.should_search_web(state):
        return "web_search"
    
    return "generate"


# ═══════════════════════════════════════════════════════════════════════════════
# STANDALONE TESTING
# ═══════════════════════════════════════════════════════════════════════════════

def test_search():
    """Quick test of Tavily search functionality."""
    print("=" * 60)
    print("TAVILY SEARCH TEST")
    print("=" * 60)
    
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        print("❌ Set TAVILY_API_KEY environment variable first")
        return
    
    tool = WebSearchTool(api_key=api_key, max_results=3)
    
    # Safe query
    response = tool.search("Python async await best practices 2024")
    
    if response.get('answer'):
        print(f"\n💡 AI Answer: {response['answer'][:200]}...")
    
    for r in response.get('results', []):
        print(f"\n📄 {r.title}")
        print(f"   🔗 {r.url}")
        print(f"   📊 Score: {r.score:.2f}")
        print(f"   📝 {r.content[:100]}...")
    
    # Blocked query test
    print("\n--- Testing blocked query ---")
    response = tool.search("how to hack websites")
    print(f"Blocked: {response.get('blocked', False)}")


if __name__ == "__main__":
    test_search()


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    "SearchResult",
    "WebSearchTool",
    "WebSearchAgent",
    "create_web_search_node",
    "route_to_web_search",
]

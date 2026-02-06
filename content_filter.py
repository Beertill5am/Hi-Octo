"""
Content Filter Module
=====================
Universal content filter with blocklist-only approach.
Blocks harmful content, allows everything else.

Usage:
    from content_filter import UniversalContentFilter, CategoryRouter
    
    filter = UniversalContentFilter()
    is_safe, reason = filter.check("user query")
"""

import re
from typing import List, Tuple, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum


class HarmCategory(Enum):
    """Categories of harmful content that are blocked."""
    SELF_HARM = "self_harm"
    ILLEGAL = "illegal"
    EXPLICIT = "explicit"
    SCAM = "scam"
    HATE = "hate"
    DANGEROUS_MISINFO = "misinfo"


@dataclass
class FilterResult:
    """Result of content filtering."""
    is_safe: bool
    blocked_category: Optional[HarmCategory] = None
    matched_pattern: Optional[str] = None
    
    @property
    def reason(self) -> str:
        if self.is_safe:
            return "Content is safe"
        return f"Blocked: {self.blocked_category.value if self.blocked_category else 'unknown'}"


class UniversalContentFilter:
    """
    Blocks ONLY harmful content. Allows everything else.
    
    Design Philosophy:
    - Blocklist approach (not whitelist)
    - Fast regex-based detection
    - Categorized harmful patterns for appropriate responses
    """
    
    HARMFUL_PATTERNS: Dict[HarmCategory, List[str]] = {
        # ════════════════════════════════════════════════════════
        # SELF-HARM / VIOLENCE TO SELF
        # ════════════════════════════════════════════════════════
        HarmCategory.SELF_HARM: [
            r"\b(suicide|suicidal)\b",
            r"\b(kill\s+(myself|yourself|oneself))\b",
            r"\b(self[- ]?harm|cutting\s+myself)\b",
            r"\b(how\s+to\s+die|end\s+my\s+life)\b",
            r"\b(ways\s+to\s+(commit|die))\b",
            r"\b(want\s+to\s+die|don'?t\s+want\s+to\s+live)\b",
        ],
        
        # ════════════════════════════════════════════════════════
        # ILLEGAL ACTIVITIES
        # ════════════════════════════════════════════════════════
        HarmCategory.ILLEGAL: [
            # Hacking / Cybercrime
            r"\b(how\s+to\s+hack)\b",
            r"\b(hack\s+(into|someone'?s))\b",
            r"\b(crack\s+(password|software|license))\b",
            r"\b(bypass\s+(security|authentication|paywall))\b",
            r"\b(exploit\s+(vulnerability|system))\b",
            # Piracy
            r"\b(pirate|torrent|crack(ed)?)\s+(movie|game|software|download)\b",
            r"\b(free\s+(cracked|pirated))\b",
            # Weapons / Drugs
            r"\b(make\s+(bomb|explosive|weapon|gun|meth|drugs))\b",
            r"\b(how\s+to\s+(synthesize|cook)\s+(meth|drugs))\b",
            r"\b(buy\s+(drugs|weapons)\s+online)\b",
            # Identity crimes
            r"\b(fake\s+(id|passport|degree|certificate|diploma))\b",
            r"\b(forge\s+(document|signature))\b",
            # Worst category
            r"\b(child\s+(porn|exploitation)|csam|cp\b)",
        ],
        
        # ════════════════════════════════════════════════════════
        # EXPLICIT / NSFW CONTENT
        # ════════════════════════════════════════════════════════
        HarmCategory.EXPLICIT: [
            r"\b(porn|pornograph(y|ic))\b",
            r"\bxxx\b",
            r"\b(nsfw|nude|naked)\s+(image|photo|video|content)\b",
            r"\b(sex\s+(video|tape|scene))\b",
            r"\b(hentai|rule\s*34)\b",
            r"\b(onlyfans\s+(leak|content))\b",
            r"\b(escort|prostitut)\b",
            r"\b(erotic|sexually\s+explicit)\b",
            r"\b(adult\s+content|18\+\s+content)\b",
        ],
        
        # ════════════════════════════════════════════════════════
        # SCAMS / FRAUD
        # ════════════════════════════════════════════════════════
        HarmCategory.SCAM: [
            r"\b(get\s+rich\s+quick)\b",
            r"\b(pyramid\s+scheme|ponzi)\b",
            r"\b(credit\s+card\s+fraud)\b",
            r"\b(identity\s+theft)\b",
            r"\b(phishing\s+(email|page|site))\b",
            r"\b(buy\s+(fake\s+)?(followers|likes|reviews))\b",
            r"\b(money\s+laundering)\b",
            r"\b(wire\s+fraud)\b",
            r"\b(nigerian\s+prince)\b",  # Classic scam reference
        ],
        
        # ════════════════════════════════════════════════════════
        # HATE SPEECH / HARASSMENT
        # ════════════════════════════════════════════════════════
        HarmCategory.HATE: [
            r"\b(kill\s+all\s+\w+)\b",
            r"\b(genocide)\b",
            r"\b(ethnic\s+cleansing)\b",
            r"\b(hate\s+(group|speech|crime))\b",
            r"\b(white\s+supremac|nazi)\b",
            r"\b(terroris[tm]|jihad)\b",
            # Note: Actual slurs omitted but would be included in production
        ],
        
        # ════════════════════════════════════════════════════════
        # DANGEROUS MISINFORMATION
        # ════════════════════════════════════════════════════════
        HarmCategory.DANGEROUS_MISINFO: [
            r"\b(vaccine\s+(cause|causes)\s+autism)\b",
            r"\b(5g\s+(cause|causes|spread)\s+(covid|corona))\b",
            r"\b(flat\s+earth\s+proof)\b",
            r"\b(miracle\s+cure\s+(they|doctors)\s+hide)\b",
            r"\b(ivermectin\s+(cure|treat)\s+covid)\b",
        ],
    }
    
    # Rejection messages per category
    REJECTION_MESSAGES: Dict[HarmCategory, str] = {
        HarmCategory.SELF_HARM: """
I'm concerned about your wellbeing. Please reach out to someone who can help:

🇮🇳 **India**: iCall 9152987821 | Vandrevala Foundation 1860-2662-345-16
🇺🇸 **USA**: 988 Suicide & Crisis Lifeline
🌍 **International**: findahelpline.com

You're not alone. Help is available 24/7.
""",
        HarmCategory.ILLEGAL: "I can't assist with activities that may be illegal or cause harm to others.",
        HarmCategory.EXPLICIT: "I can't help with explicit or adult content requests.",
        HarmCategory.SCAM: "I can't assist with fraudulent, deceptive, or scam-related activities.",
        HarmCategory.HATE: "I can't help with content that promotes hate, violence, or discrimination.",
        HarmCategory.DANGEROUS_MISINFO: "I can't help spread information that may be harmful to health or safety.",
    }
    
    def __init__(self):
        """Initialize the filter with compiled regex patterns."""
        self._compiled_patterns: Dict[HarmCategory, re.Pattern] = {}
        
        for category, patterns in self.HARMFUL_PATTERNS.items():
            combined = "|".join(patterns)
            self._compiled_patterns[category] = re.compile(combined, re.IGNORECASE)
    
    def check(self, query: str) -> FilterResult:
        """
        Check if a query contains harmful content.
        
        Args:
            query: The user's input query
            
        Returns:
            FilterResult with is_safe=True if allowed, False if blocked
        """
        if not query or not query.strip():
            return FilterResult(is_safe=True)
        
        # Check each harm category
        for category, pattern in self._compiled_patterns.items():
            match = pattern.search(query)
            if match:
                return FilterResult(
                    is_safe=False,
                    blocked_category=category,
                    matched_pattern=match.group(0)
                )
        
        # No harmful content found - ALLOW
        return FilterResult(is_safe=True)
    
    def get_rejection_message(self, category: HarmCategory) -> str:
        """Get the appropriate rejection message for a harm category."""
        return self.REJECTION_MESSAGES.get(
            category, 
            "I can't help with that request."
        )
    
    def check_and_get_message(self, query: str) -> Tuple[bool, str]:
        """
        Convenience method that returns (is_safe, message).
        
        Returns:
            (True, "OK") if safe
            (False, rejection_message) if blocked
        """
        result = self.check(query)
        
        if result.is_safe:
            return True, "OK"
        
        message = self.get_rejection_message(result.blocked_category)
        return False, message


class CategoryRouter:
    """
    Routes queries to appropriate knowledge base categories.
    Works with dynamic categories - no hardcoding.
    """
    
    def __init__(self, vectorstore=None, llm=None):
        """
        Args:
            vectorstore: Chroma vectorstore to get categories from
            llm: LLM for semantic category matching (optional)
        """
        self.vectorstore = vectorstore
        self.llm = llm
        self.content_filter = UniversalContentFilter()
    
    def get_available_categories(self) -> List[str]:
        """Fetch current categories from vectorstore."""
        if not self.vectorstore:
            return []
        
        try:
            data = self.vectorstore.get(include=["metadatas"])
            categories = set()
            for meta in data.get("metadatas", []):
                if meta and "category" in meta:
                    categories.add(meta["category"])
            return list(categories)
        except Exception:
            return []
    
    def route(self, query: str) -> Dict[str, Any]:
        """
        Route a query to appropriate action.
        
        Returns:
            {
                "action": "search" | "search_all" | "reject" | "web_search",
                "category": str | None,
                "message": str,
                "is_safe": bool
            }
        """
        # Step 1: Safety check
        is_safe, message = self.content_filter.check_and_get_message(query)
        
        if not is_safe:
            return {
                "action": "reject",
                "category": None,
                "message": message,
                "is_safe": False
            }
        
        # Step 2: Get available categories
        categories = self.get_available_categories()
        
        if not categories:
            # No local KB - suggest web search
            return {
                "action": "web_search",
                "category": None,
                "message": "No local knowledge base found. Searching the web...",
                "is_safe": True
            }
        
        # Step 3: Try to match category
        matched = self._match_category(query, categories)
        
        if matched:
            return {
                "action": "search",
                "category": matched,
                "message": f"Searching '{matched}' knowledge base...",
                "is_safe": True
            }
        
        # Step 4: No specific match - search all categories
        return {
            "action": "search_all",
            "category": None,
            "message": f"Searching across {len(categories)} categories...",
            "is_safe": True
        }
    
    def _match_category(self, query: str, categories: List[str]) -> Optional[str]:
        """
        Match query to a category.
        Uses simple keyword matching first, then LLM if available.
        """
        query_lower = query.lower()
        
        # Simple keyword match first
        for cat in categories:
            if cat.lower() in query_lower:
                return cat
        
        # If only one category, use it
        if len(categories) == 1:
            return categories[0]
        
        # Use LLM for semantic matching if available
        if self.llm:
            try:
                prompt = f"""Query: "{query}"
Categories: {categories}

Which category best matches? Respond with ONLY the category name, or "none" if no match."""
                
                response = self.llm.invoke(prompt).content.strip().lower()
                
                for cat in categories:
                    if cat.lower() == response:
                        return cat
            except Exception:
                pass
        
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# LANGGRAPH NODE FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def create_guardrail_node(content_filter: UniversalContentFilter):
    """
    Factory function to create a guardrail node for LangGraph.
    
    Usage:
        guardrail_node = create_guardrail_node(UniversalContentFilter())
        graph.add_node("guardrail", guardrail_node)
    """
    def input_guardrail_node(state: dict) -> dict:
        """
        First node in pipeline - checks for harmful content.
        """
        query = state.get('topic', '') or state.get('query', '')
        
        result = content_filter.check(query)
        
        if not result.is_safe:
            message = content_filter.get_rejection_message(result.blocked_category)
            return {
                "is_safe": False,
                "blocked_category": result.blocked_category.value,
                "rejection_message": message,
                "answer": message  # Provide immediate answer
            }
        
        return {
            "is_safe": True,
            "blocked_category": None,
            "rejection_message": None
        }
    
    return input_guardrail_node


def route_from_guardrail(state: dict) -> str:
    """
    Routing function for guardrail node.
    
    Usage:
        graph.add_conditional_edges(
            "guardrail",
            route_from_guardrail,
            {"proceed": "dispatcher", "reject": END}
        )
    """
    if state.get('is_safe', True):
        return "proceed"
    return "reject"


# ═══════════════════════════════════════════════════════════════════════════════
# EXPORTS
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    "HarmCategory",
    "FilterResult", 
    "UniversalContentFilter",
    "CategoryRouter",
    "create_guardrail_node",
    "route_from_guardrail",
]

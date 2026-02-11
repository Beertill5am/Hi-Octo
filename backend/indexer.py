from typing import Any, Dict, List, Tuple

from agent_pipeline import intelligent_chunking, router
from agent_pipeline_extensions import preflight_analysis, print_preflight_report


def index_file(file_path: str) -> Tuple[List[Any], Dict[str, Any]]:
    markdown_content = router.route(file_path)
    splits = intelligent_chunking(markdown_content)
    preflight = preflight_analysis(splits)
    print_preflight_report(preflight)
    return splits, preflight

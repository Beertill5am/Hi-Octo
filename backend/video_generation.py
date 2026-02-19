"""
Video generation helpers for post-answer Remotion rendering.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from collections import Counter
from typing import Any, Dict, List, Optional


# ── BPM timing constants ────────────────────────────────────────────────
_BPM = 120
_BEAT_MS = round(60_000 / _BPM)  # 500 ms at 120 BPM
_QUANT_MS = _BEAT_MS * 2          # snap to 2-beat grid (1 000 ms)


def _quantize(ms: int, floor: int = 3000, ceil: int = 9000) -> int:
    """Snap *ms* to the nearest _QUANT_MS grid, clamped to [floor, ceil]."""
    q = max(floor, min(ceil, round(ms / _QUANT_MS) * _QUANT_MS))
    return q


# ── Color-mood classifier ───────────────────────────────────────────────
_COLOR_MOOD_RULES: List[tuple] = [
    (r"\bpython\b",                        "python"),
    (r"\b(?:data|database|sql|pandas)\b",  "data"),
    (r"\b(?:secur|auth|encrypt|password)\b", "security"),
    (r"\b(?:perf|optim|fast|latenc|cache)\b", "performance"),
    (r"\b(?:web|html|css|react|frontend)\b", "web"),
    (r"\b(?:machine.?learn|neural|ai|model)\b", "ai"),
]


def _classify_color_mood(topic: str) -> str:
    """Derive a colorMood token from the topic string."""
    lowered = (topic or "").lower()
    for pattern, mood in _COLOR_MOOD_RULES:
        if re.search(pattern, lowered):
            return mood
    return "default"


# ── Content-type classifier ─────────────────────────────────────────────
_COMPARISON_RE = re.compile(
    r"\b(?:vs\.?|versus|compared\s+to|unlike|whereas|better\s+than|worse\s+than"
    r"|in\s+contrast|on\s+the\s+other\s+hand)\b",
    re.IGNORECASE,
)
_PROCESS_RE = re.compile(
    r"(?:^|\b)(?:step\s*\d|first(?:ly)?[,.]|then[,.]|next[,.]|finally[,.]|second(?:ly)?[,.]"
    r"|third(?:ly)?[,.]|lastly[,.])\b",
    re.IGNORECASE,
)
_STAT_RE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:%|percent|x\s+(?:faster|slower|more|less)|times)",
    re.IGNORECASE,
)
_DEFINITION_RE = re.compile(
    r"\b(?:is\s+defined\s+as|refers\s+to|is\s+a\b|is\s+an\b|means\s+that|known\s+as)\b",
    re.IGNORECASE,
)


def _classify_content(
    bullets: List[str],
) -> tuple:
    """Return (contentType, contentData) for a bullet group."""
    joined = " ".join(bullets)

    # ── Comparison ──
    if _COMPARISON_RE.search(joined):
        parts = re.split(r"\bvs\.?\b|\bversus\b|\bcompared\s+to\b|\bunlike\b|\bwhereas\b", joined, maxsplit=1, flags=re.IGNORECASE)
        left = parts[0].strip() if len(parts) > 0 else bullets[0]
        right = parts[1].strip() if len(parts) > 1 else (bullets[1] if len(bullets) > 1 else "")
        return "comparison", {
            "left": left[:160],
            "right": right[:160],
            "leftLabel": left.split()[0] if left else "A",
            "rightLabel": right.split()[0] if right else "B",
        }

    # ── Process / Steps ──
    if _PROCESS_RE.search(joined) or all(re.match(r"^\d+[\.\)]", b.strip()) for b in bullets if b.strip()):
        steps = []
        for b in bullets:
            label = re.sub(r"^\d+[\.\)]\s*", "", b.strip())
            first_sentence = re.split(r"(?<=[.!?])\s+", label)[0]
            steps.append({"label": first_sentence[:60], "detail": label[:160]})
        return "process", {"steps": steps}

    # ── Statistic ──
    stat_match = _STAT_RE.search(joined)
    if stat_match:
        raw = stat_match.group(0)
        num = re.search(r"[\d.]+", raw)
        value = float(num.group()) if num else 0
        unit = raw.replace(num.group(), "").strip() if num else "%"
        return "statistic", {
            "value": value,
            "unit": unit,
            "label": bullets[0][:120],
        }

    # ── Definition ──
    if _DEFINITION_RE.search(joined):
        parts = re.split(
            r"\bis\s+defined\s+as\b|\brefers\s+to\b|\bis\s+an?\b|\bmeans\s+that\b|\bknown\s+as\b",
            bullets[0], maxsplit=1, flags=re.IGNORECASE
        )
        term = parts[0].strip()[:60] if parts else ""
        definition = parts[1].strip()[:200] if len(parts) > 1 else bullets[0][:200]
        return "definition", {"term": term, "definition": definition}

    return "general", None


def build_video_script(topic: str, answer: str) -> Dict[str, Any]:
    """
    Convert generated answer text into a scene-based script for motion graphics.
    """
    clean = _sanitize_markdown(answer or "")
    if not clean:
        clean = "No answer content available."

    bullets = summarize_for_video(clean, max_bullets=8)
    scenes = _build_bullet_scenes(bullets)
    total_duration_ms = sum(scene["durationMs"] for scene in scenes)
    color_mood = _classify_color_mood(topic)

    return {
        "title": topic[:140] if topic else "Generated Report",
        "theme": {
            "palette": ["#101828", "#004E98", "#3A86FF", "#F6AE2D", "#F5F7FA"],
            "fontFamily": "Manrope, Inter, system-ui, sans-serif",
            "energy": "high",
            "colorMood": color_mood,
        },
        "composition": {
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "durationMs": total_duration_ms,
            "aspectRatio": "16:9",
        },
        "scenes": scenes,
    }


def render_video_with_remotion(
    *,
    job_id: str,
    topic: str,
    answer: str,
    script: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Render a video by calling a Remotion service.

    Expected response payload:
    {
      "videoUrl": "...",
      "posterUrl": "...",
      "durationMs": 12345,
      "aspectRatio": "16:9"
    }
    """
    endpoint = (os.getenv("REMOTION_RENDER_ENDPOINT") or "").strip()
    if not endpoint:
        raise RuntimeError("REMOTION_RENDER_ENDPOINT is not configured")

    payload = {
        "jobId": job_id,
        "topic": topic,
        "answer": answer,
        "script": script,
        "qualityProfile": "high",
        "ttsEnabled": False,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    timeout_s = float(os.getenv("REMOTION_RENDER_TIMEOUT_S", "180"))
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Remotion render HTTP {exc.code}: {detail[:240]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Unable to reach Remotion render service: {exc.reason}") from exc

    video_url = str(data.get("videoUrl") or data.get("video_url") or "").strip()
    if not video_url:
        raise RuntimeError("Remotion render did not return a video URL")

    return {
        "video_url": video_url,
        "poster_url": str(data.get("posterUrl") or data.get("poster_url") or "").strip() or None,
        "duration_ms": int(data.get("durationMs") or data.get("duration_ms") or script["composition"]["durationMs"]),
        "aspect_ratio": str(data.get("aspectRatio") or data.get("aspect_ratio") or script["composition"]["aspectRatio"]),
        "provider_job_id": str(data.get("providerJobId") or data.get("provider_job_id") or "").strip() or None,
    }


def fallback_video_url() -> Optional[str]:
    """
    Optional fallback video URL for local development/demo.
    """
    url = (os.getenv("VIDEO_FALLBACK_URL") or "").strip()
    return url or None


_BODY_PRESETS = [
    "hero_zoom_reveal",
    "kinetic_slide_grid",
    "parallax_depth_cards",
    "contrast_wipe",
    "glow_track_emphasis",
]

# Map content types to their optimal motion preset
_CONTENT_PRESET_MAP: Dict[str, str] = {
    "comparison":  "kinetic_slide_grid",
    "process":     "glow_track_emphasis",
    "statistic":   "chart_pulse_highlight",
    "definition":  "hero_zoom_reveal",
}


def _narrative_preset(
    scene_idx: int, total_scenes: int, content_type: str = "general"
) -> str:
    """5-beat director arc: Hook → Core Insight → Proof → Contrarian → Closing."""
    if scene_idx == 0:
        return "intro"                             # Beat 1: Hook
    if scene_idx == total_scenes - 1 and total_scenes > 2:
        return "outro"                              # Beat 5: Closing
    if scene_idx == total_scenes - 2 and total_scenes > 3:
        return "chart_pulse_highlight"               # Beat 4: Contrarian / Climax
    if scene_idx == 1:
        return "hero_zoom_reveal"                    # Beat 2: Core Insight
    # Beat 3: Proof — prefer content-type-optimal preset, else cycle body presets
    if content_type in _CONTENT_PRESET_MAP:
        return _CONTENT_PRESET_MAP[content_type]
    body_idx = (scene_idx - 2) % len(_BODY_PRESETS)
    return _BODY_PRESETS[body_idx]


def _smart_title(
    group: List[str], scene_idx: int, total_scenes: int, content_type: str = "general"
) -> str:
    """Generate a contextual scene title from content type and bullet text."""
    if scene_idx == 0:
        return "The Hook"
    if scene_idx == 1:
        return "Core Insight"
    if scene_idx == total_scenes - 1 and total_scenes > 2:
        return "Key Takeaways"
    if scene_idx == total_scenes - 2 and total_scenes > 3:
        return "The Big Picture"
    # Content-type-aware titles
    _TYPE_LABELS = {
        "comparison": "Head to Head",
        "process": "Step by Step",
        "statistic": "By the Numbers",
        "definition": "What It Means",
    }
    if content_type in _TYPE_LABELS:
        return _TYPE_LABELS[content_type]
    # Fallback: first sentence of first bullet
    if group:
        first = re.split(r"(?<=[.!?])\s+", group[0].strip())[0].strip()
        title = first[:72].strip()
        if title:
            return title
    return f"Point {scene_idx + 1}"


def summarize_for_video(text: str, max_bullets: int = 8) -> List[str]:
    """
    Extract concise, viewer-friendly bullets from long generated text.
    """
    normalized = _sanitize_markdown(text)
    if not normalized:
        return ["No answer content available."]

    explicit_bullets = _extract_explicit_bullets(text)
    if len(explicit_bullets) >= 3:
        return explicit_bullets[:max_bullets]

    sentences = _split_sentences(normalized)
    if not sentences:
        return [normalized[:180]]

    scored = _score_sentences(sentences)
    top = [s for _, s in sorted(scored, key=lambda x: x[0], reverse=True)[: max_bullets * 2]]

    selected: List[str] = []
    for sentence in top:
        short = _truncate_sentence(sentence, 160)
        if not short:
            continue
        if short not in selected:
            selected.append(short)
        if len(selected) >= max_bullets:
            break

    if not selected:
        selected = [_truncate_sentence(s, 160) for s in sentences[:max_bullets] if s.strip()]

    return selected[:max_bullets] or ["No answer content available."]


def _build_bullet_scenes(bullets: List[str]) -> List[Dict[str, Any]]:
    """Build scenes with 5-beat director arc + content-type detection + BPM timing."""
    scenes: List[Dict[str, Any]] = []
    start_ms = 0
    chunk_size = 2
    groups: List[List[str]] = []
    for idx in range(0, len(bullets), chunk_size):
        groups.append(bullets[idx : idx + chunk_size])

    total_scenes = len(groups)

    for idx, group in enumerate(groups):
        total_words = sum(len(item.split()) for item in group)

        # Classify content type for this bullet group
        content_type, content_data = _classify_content(group)

        # Director + content-aware preset
        preset = _narrative_preset(idx, total_scenes, content_type)

        # BPM-quantized duration (different ceilings per beat role)
        if preset == "intro":
            raw_ms = total_words * 280
            duration_ms = _quantize(raw_ms, floor=3000, ceil=5000)
        elif preset == "chart_pulse_highlight":
            raw_ms = total_words * 320
            duration_ms = _quantize(raw_ms, floor=4000, ceil=9000)
        elif preset == "outro":
            raw_ms = total_words * 280
            duration_ms = _quantize(raw_ms, floor=3000, ceil=7000)
        else:
            raw_ms = total_words * 260
            duration_ms = _quantize(raw_ms, floor=3000, ceil=8000)

        title = _smart_title(group, idx, total_scenes, content_type)

        scene: Dict[str, Any] = {
            "id": f"scene_{idx + 1}",
            "startMs": start_ms,
            "durationMs": duration_ms,
            "title": title,
            "onScreenText": "\n".join(group),
            "bulletPoints": group,
            "motionPreset": preset,
            "visualStyle": "cinematic_kinetic_typography",
            "contentType": content_type,
        }
        if content_data is not None:
            scene["contentData"] = content_data
        scenes.append(scene)
        start_ms += duration_ms

    return scenes or [
        {
            "id": "scene_1",
            "startMs": 0,
            "durationMs": 3000,
            "title": "Summary",
            "onScreenText": "No answer content available.",
            "bulletPoints": ["No answer content available."],
            "motionPreset": "intro",
            "visualStyle": "cinematic_kinetic_typography",
            "contentType": "general",
        }
    ]


def _sanitize_markdown(text: str) -> str:
    value = (text or "").strip()
    if not value:
        return ""
    lines: List[str] = []
    for raw_line in value.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            lines.append("")
            continue
        # Drop markdown table separator rows like |---|---| or |:---|---:|
        if re.match(r"^\s*\|?[\s:-]+\|[\s|:-]*\|?\s*$", line):
            continue
        # Remove repeated dash bullets like "-- item"
        line = re.sub(r"^\s*-{2,}\s*", "", line)
        # Convert table cell pipes into readable separators.
        line = re.sub(r"\s*\|\s*", ", ", line)
        lines.append(line)
    value = "\n".join(lines)
    # Remove fenced code blocks.
    value = re.sub(r"```[\s\S]*?```", " ", value)
    # Remove inline code markers.
    value = re.sub(r"`([^`]*)`", r"\1", value)
    # Convert markdown links to visible text.
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", value)
    # Remove heading/list/quote markers.
    value = re.sub(r"^\s{0,3}(#{1,6}|\*|-|\+|>)\s*", "", value, flags=re.MULTILINE)
    value = re.sub(r"^\s*\d+\.\s+", "", value, flags=re.MULTILINE)
    # Remove emphasis markers.
    value = re.sub(r"[*_~]", "", value)
    # Collapse duplicated punctuation from list/table leftovers.
    value = re.sub(r"(,\s*){2,}", ", ", value)
    value = re.sub(r"\s*-\s*-+\s*", " ", value)
    # Collapse extra whitespace.
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _extract_explicit_bullets(text: str) -> List[str]:
    bullets: List[str] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        normalized = re.sub(r"^\s*(?:[-*+]+|\d+\.)\s+", "", line).strip()
        if normalized != line and normalized:
            bullets.append(_truncate_sentence(_sanitize_markdown(normalized), 160))
    # Preserve order while removing empties/dupes.
    seen = set()
    uniq: List[str] = []
    for item in bullets:
        if not item or item in seen:
            continue
        seen.add(item)
        uniq.append(item)
    return uniq


def _split_sentences(text: str) -> List[str]:
    candidates = re.split(r"(?<=[.!?])\s+", text)
    return [c.strip() for c in candidates if len(c.strip()) >= 30]


def _score_sentences(sentences: List[str]) -> List[tuple[float, str]]:
    stopwords = {
        "the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "with",
        "is", "are", "was", "were", "be", "this", "that", "it", "as", "by",
        "from", "at", "if", "then", "than", "can", "will", "should", "you",
    }
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]*", " ".join(sentences).lower())
    freq = Counter(w for w in words if w not in stopwords and len(w) > 2)

    scored: List[tuple[float, str]] = []
    for sentence in sentences:
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]*", sentence.lower())
        keyword_score = sum(freq.get(t, 0) for t in tokens if t not in stopwords)
        length_penalty = abs(len(sentence.split()) - 22) * 0.4
        score = keyword_score - length_penalty
        scored.append((score, sentence))
    return scored


def _truncate_sentence(text: str, max_chars: int) -> str:
    value = (text or "").strip()
    if len(value) <= max_chars:
        return value
    clipped = value[: max_chars - 1]
    if " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0]
    return f"{clipped}..."

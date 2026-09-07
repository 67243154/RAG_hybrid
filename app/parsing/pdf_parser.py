from __future__ import annotations

import re
from typing import Any

import fitz

from app.parsing.models import Paragraph

TEXT_BLOCK_TYPE = 0
_CHAPTER_RE = re.compile(r"^第\s*[一二三四五六七八九十百千万\d]+\s*[章节篇部]\b\s*\S*")
_CN_SECTION_RE = re.compile(r"^[一二三四五六七八九十百千万\d]+\s*[、.．)]\s*\S+")
_NUM_SECTION_RE = re.compile(r"^\d+(?:\.\d+)*\s*[、.．)]\s*\S+")
_PAREN_SECTION_RE = re.compile(r"^[（(]\s*[一二三四五六七八九十\d]+\s*[）)]\s*\S+")


def _span_size(span: dict[str, Any]) -> float:
    try:
        return float(span.get("size") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _span_bold(span: dict[str, Any]) -> bool:
    try:
        return bool(int(span.get("flags") or 0) & 16)
    except (TypeError, ValueError):
        return False


def _block_text(block: dict[str, Any]) -> tuple[str, float, bool]:
    parts: list[str] = []
    sizes: list[float] = []
    bold = False
    for line in block.get("lines") or []:
        line_parts: list[str] = []
        for span in line.get("spans") or []:
            value = str(span.get("text") or "").strip()
            if value:
                line_parts.append(value)
                sizes.append(_span_size(span))
                bold = bold or _span_bold(span)
        if line_parts:
            parts.append(" ".join(line_parts))
    return " ".join(parts).strip(), (max(sizes) if sizes else 0.0), bold


def _heading_level(text: str, *, font_size: float, bold: bool, body_size: float) -> int | None:
    compact = " ".join(text.split())
    if not compact or len(compact) > 120:
        return None
    structured = bool(
        _CHAPTER_RE.match(compact)
        or _CN_SECTION_RE.match(compact)
        or _PAREN_SECTION_RE.match(compact)
        or _NUM_SECTION_RE.match(compact)
    )
    if structured:
        # Numbered body paragraphs and page numbers are common in handbooks;
        # require typography support before promoting them to headings.
        styled = font_size >= body_size * 1.08 or bold
        if not styled:
            return None
        if _CHAPTER_RE.match(compact):
            return 1
        if _CN_SECTION_RE.match(compact) or _PAREN_SECTION_RE.match(compact):
            return 2
        if _NUM_SECTION_RE.match(compact) and len(compact) <= 80:
            number = re.match(r"^(\d+(?:\.\d+)*)", compact)
            return (number.group(1).count(".") + 1) if number else 1
        return None
    if len(compact) <= 80 and body_size > 0:
        if font_size >= body_size * 1.22:
            return 1
        if bold and font_size >= body_size * 1.08:
            return 2
    return None


def _heading_path_for(level: int, text: str, stack: list[tuple[int, str]]) -> tuple[str, ...]:
    level = max(1, min(level, len(stack) + 1))
    while stack and stack[-1][0] >= level:
        stack.pop()
    stack.append((level, text))
    return tuple(value for _, value in stack)


def extract_paragraphs(pdf_path: str) -> list[Paragraph]:
    """Extract text blocks and conservatively reconstruct PDF heading paths."""
    raw_blocks: list[dict[str, Any]] = []
    sizes: list[float] = []
    with fitz.open(pdf_path) as doc:
        for page_index, page in enumerate(doc):
            page_number = page_index + 1
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != TEXT_BLOCK_TYPE:
                    continue
                text, font_size, bold = _block_text(block)
                if not text:
                    continue
                raw_blocks.append(
                    {
                        "page_number": page_number,
                        "text": text,
                        "font_size": font_size,
                        "bold": bold,
                        "bbox": block.get("bbox") or (0, 0, 0, 0),
                    }
                )
                if font_size > 0:
                    sizes.append(font_size)

    raw_blocks.sort(
        key=lambda block: (
            int(block["page_number"]),
            round(float(block["bbox"][1]), 1),
            float(block["bbox"][0]),
        )
    )
    if sizes:
        ordered_sizes = sorted(sizes)
        body_size = ordered_sizes[int((len(ordered_sizes) - 1) * 0.25)]
    else:
        body_size = 0.0
    paragraphs: list[Paragraph] = []
    stack: list[tuple[int, str]] = []
    occurrences: dict[tuple[str, ...], int] = {}
    page_indexes: dict[int, int] = {}
    for block in raw_blocks:
        page_number = int(block["page_number"])
        text = str(block["text"])
        # Standalone small numerals at the page margin are printed page
        # numbers, not content. Keeping them pollutes the preamble and can
        # make the previous page's heading appear to continue.
        if re.fullmatch(r"\d{1,4}", text) and float(block["font_size"]) < body_size * 0.95:
            continue
        paragraph_index = page_indexes.get(page_number, 0)
        page_indexes[page_number] = paragraph_index + 1
        level = _heading_level(
            text,
            font_size=float(block["font_size"]),
            bold=bool(block["bold"]),
            body_size=body_size,
        )
        if level is not None:
            heading_path = _heading_path_for(level, text, stack)
            occurrences[heading_path] = occurrences.get(heading_path, -1) + 1
            heading_occurrence = occurrences[heading_path]
        else:
            heading_path = tuple(value for _, value in stack)
            heading_occurrence = occurrences.get(heading_path, 0)
        paragraphs.append(
            Paragraph(
                page_number=page_number,
                paragraph_index=paragraph_index,
                text=text,
                heading_path=heading_path,
                heading_occurrence=heading_occurrence,
                is_heading=level is not None,
                heading_level=level,
                font_size=float(block["font_size"]) or None,
                is_bold=bool(block["bold"]),
            )
        )
    return paragraphs

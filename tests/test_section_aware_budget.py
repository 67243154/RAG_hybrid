import pytest

from app.evidence.section_aware import SectionAwareEvidenceBuilder
from app.retrieval.hybrid_search import SearchResult
from app.security.models import RetrievalContext


def chunk(chunk_id: str, text: str, source: str) -> SearchResult:
    return SearchResult(
        score=1.0,
        id=chunk_id,
        payload={
            "source_type": "filesystem",
            "source_id": source,
            "document_version": "v1",
            "tenant_id": "tenant-a",
            "heading_path": ["Policy"],
            "heading_occurrence": 0,
            "text": text,
        },
    )


def pdf_chunk(chunk_id: str, text: str, source: str, page: int) -> SearchResult:
    result = chunk(chunk_id, text, source)
    result.payload["heading_path"] = []
    result.payload["page_number"] = page
    result.payload["paragraph_index"] = 0
    return result


def test_oversized_anchor_is_truncated_without_budget_exception() -> None:
    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    block = SectionAwareEvidenceBuilder._block(
        chunk("a", "word " * 1300, "source-a"),
        [chunk("a", "word " * 1300, "source-a")],
    )
    result = builder._truncate_block(block, 1200)
    assert result.payload["truncated"] is True
    assert result.payload["visible_token_count"] == 1200
    assert result.payload["evidence_block_id"]


@pytest.mark.asyncio
async def test_over_budget_anchors_are_preserved_within_global_budget() -> None:
    anchors = [chunk("a", "a " * 800, "source-a"), chunk("b", "b " * 800, "source-b")]
    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    builder._token_budget = 1200
    builder._scroll_source = lambda anchor, context: [anchor]

    result = await builder.build(anchors, RetrievalContext("tenant-a"))

    assert len(result.blocks) == 2
    assert result.context_tokens <= 1200
    assert result.budget_exhausted is True


@pytest.mark.asyncio
async def test_rank_one_anchor_survives_head_truncation_of_merged_section() -> None:
    """Porton handbook §3.8 regression: when two anchors share a section and
    the merged block is over budget, head truncation must cut the
    lower-ranked (document-earlier) anchor, never the rank-1 anchor whose
    text is otherwise discarded entirely."""
    answer = chunk("answer", "病假条款 " * 20, "handbook")  # rank 1, 20 tokens
    answer.payload["page_number"] = 2
    large = chunk("large", "年假一般规则 " * 200, "handbook")  # rank 2, 200 tokens
    large.payload["page_number"] = 1
    toc = chunk("toc", "目录 " * 100, "handbook")  # other section, 100 tokens
    toc.payload["heading_path"] = ["目录章节"]

    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    builder._token_budget = 300  # 220 + 100 > 300 -> merged group truncated
    builder._scroll_source = lambda anchor, context: [large, answer]

    result = await builder.build(
        [answer, large, toc], RetrievalContext("tenant-a")
    )

    merged = next(
        block
        for block in result.blocks
        if block.payload["contributing_chunk_ids"] == ["answer", "large"]
    )
    text = merged.payload["text"]
    assert text.startswith("病假条款")  # rank-1 anchor leads the block
    assert "病假条款 病假条款 病假条款" in text  # rank-1 anchor fully preserved
    assert merged.payload["truncated"] is True  # the large rank-2 anchor was cut
    assert result.context_tokens <= 300


@pytest.mark.asyncio
async def test_expansion_chunks_follow_anchors_regardless_of_document_order() -> None:
    """Phase B expansions join after the reranked anchors even when they sit
    earlier in the document, so anchor content always leads the block."""
    answer = chunk("answer", "答案要点 " * 10, "handbook")
    answer.payload["page_number"] = 2
    preamble = chunk("preamble", "章节前言 " * 30, "handbook")
    preamble.payload["page_number"] = 0  # document-earliest, NOT an anchor

    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    builder._token_budget = 400  # everything fits, no truncation
    builder._scroll_source = lambda anchor, context: [preamble, answer]

    result = await builder.build([answer], RetrievalContext("tenant-a"))

    assert len(result.blocks) == 1
    assert result.blocks[0].payload["contributing_chunk_ids"] == ["answer", "preamble"]
    assert result.blocks[0].payload["text"].startswith("答案要点")


def test_duplicate_chunks_are_deduplicated_deterministically() -> None:
    items = [chunk("a", "same", "source-a"), chunk("a", "same", "source-a")]
    assert [item.id for item in SectionAwareEvidenceBuilder._unique_chunks(items)] == ["a"]


@pytest.mark.asyncio
async def test_pdf_anchors_from_different_pages_create_separate_blocks() -> None:
    anchors = [
        pdf_chunk("toc", "目录：愿景", "handbook", 2),
        pdf_chunk("vision", "愿景：成为可靠的制药服务平台", "handbook", 7),
    ]
    scroll_calls = 0
    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    builder._token_budget = 1200

    def scroll_source(anchor, context):
        nonlocal scroll_calls
        scroll_calls += 1
        return anchors

    builder._scroll_source = scroll_source

    result = await builder.build(anchors, RetrievalContext("tenant-a"))

    assert len(result.blocks) == 2
    assert [block.payload["section_key"] for block in result.blocks] == [
        ["page", 2],
        ["page", 7],
    ]
    assert [block.payload["contributing_chunk_ids"] for block in result.blocks] == [
        ["toc"],
        ["vision"],
    ]
    assert scroll_calls == 1


@pytest.mark.asyncio
async def test_same_page_in_different_pdfs_remains_separate() -> None:
    anchors = [
        pdf_chunk("a", "第一页", "handbook-a", 7),
        pdf_chunk("b", "第二页", "handbook-b", 7),
    ]
    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    builder._token_budget = 1200
    builder._scroll_source = lambda anchor, context: [anchor]

    result = await builder.build(anchors, RetrievalContext("tenant-a"))

    assert len(result.blocks) == 2
    assert [block.payload["source_id"] for block in result.blocks] == [
        "handbook-a",
        "handbook-b",
    ]

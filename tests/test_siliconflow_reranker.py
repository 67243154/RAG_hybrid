import json

import httpx
import pytest

from app.reranker.siliconflow import SiliconFlowReranker, SiliconFlowRerankerError
from app.retrieval.hybrid_search import SearchResult


def _candidate(identifier: str, text: str, headings: list[str] | None = None) -> SearchResult:
    return SearchResult(
        id=identifier,
        score=0.1,
        payload={"text": text, "heading_path": headings or []},
    )


@pytest.mark.asyncio
async def test_reranker_calls_api_and_preserves_candidate_identity():
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured.update(request=request, body=json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "results": [
                    {"index": 1, "relevance_score": 0.95},
                    {"index": 0, "relevance_score": 0.25},
                ]
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.siliconflow.cn/v1/",
        transport=httpx.MockTransport(handler),
    )
    reranker = SiliconFlowReranker(
        "BAAI/bge-reranker-v2-m3", api_key="secret", http_client=client
    )
    first = _candidate("first", "first text", ["Chapter", "Section"])
    second = _candidate("second", "second text")

    result = await reranker.async_rerank("query", [first, second], top_n=2)

    assert [item.id for item in result] == ["second", "first"]
    assert [item.score for item in result] == [0.95, 0.25]
    assert result[0].payload is second.payload
    assert captured["request"].headers["authorization"] == "Bearer secret"
    assert captured["body"] == {
        "model": "BAAI/bge-reranker-v2-m3",
        "query": "query",
        "documents": ["Chapter > Section\n\nfirst text", "second text"],
        "top_n": 2,
        "return_documents": False,
    }
    await client.aclose()


@pytest.mark.asyncio
async def test_reranker_rejects_invalid_response_indexes():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [{"index": 4, "relevance_score": 1}]})

    async with httpx.AsyncClient(
        base_url="https://api.siliconflow.cn/v1/",
        transport=httpx.MockTransport(handler),
    ) as client:
        reranker = SiliconFlowReranker("model", api_key="secret", http_client=client)
        with pytest.raises(SiliconFlowRerankerError, match="unexpected format"):
            await reranker.async_rerank("query", [_candidate("one", "text")], 1)


@pytest.mark.asyncio
async def test_reranker_reports_http_status_without_leaking_response_body():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "secret provider detail"})

    async with httpx.AsyncClient(
        base_url="https://api.siliconflow.cn/v1/",
        transport=httpx.MockTransport(handler),
    ) as client:
        reranker = SiliconFlowReranker("model", api_key="secret", http_client=client)
        with pytest.raises(SiliconFlowRerankerError, match="HTTP 401") as exc_info:
            await reranker.async_rerank("query", [_candidate("one", "text")], 1)
        assert "provider detail" not in str(exc_info.value)

"""Async reranker backed by SiliconFlow's ``/v1/rerank`` API."""

import asyncio
from typing import Any

import httpx

from app.retrieval.hybrid_search import SearchResult


class SiliconFlowRerankerError(RuntimeError):
    """Raised when SiliconFlow cannot return a valid reranking result."""


class SiliconFlowReranker:
    backend = "siliconflow"

    def __init__(
        self,
        model_name: str,
        *,
        api_key: str,
        base_url: str = "https://api.siliconflow.cn/v1",
        http_client: httpx.AsyncClient | None = None,
        connect_timeout: float = 10.0,
        timeout: float = 180.0,
        overall_timeout: float = 240.0,
    ) -> None:
        self.model_name = model_name
        self.overall_timeout = overall_timeout
        self._headers = {"Authorization": f"Bearer {api_key}"}
        transport_timeout = httpx.Timeout(
            connect=connect_timeout,
            read=timeout,
            write=timeout,
            pool=connect_timeout,
        )
        self._client = http_client or httpx.AsyncClient(
            base_url=f"{base_url.rstrip('/')}/",
            timeout=transport_timeout,
        )
        self._owns_client = http_client is None

    @staticmethod
    def _candidate_text(candidate: SearchResult) -> str:
        headings = candidate.payload.get("heading_path") or []
        text = candidate.payload["text"]
        if headings:
            return " > ".join(headings) + "\n\n" + text
        return text

    async def async_rerank(
        self, query: str, candidates: list[SearchResult], top_n: int
    ) -> list[SearchResult]:
        if not candidates:
            return []

        payload = {
            "model": self.model_name,
            "query": query,
            "documents": [self._candidate_text(candidate) for candidate in candidates],
            "top_n": min(top_n, len(candidates)),
            "return_documents": False,
        }
        try:
            async with asyncio.timeout(self.overall_timeout):
                response = await self._client.post(
                    "rerank", headers=self._headers, json=payload
                )
                response.raise_for_status()
        except TimeoutError as exc:
            raise SiliconFlowRerankerError(
                f"SiliconFlow rerank request timed out after {self.overall_timeout:g}s"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise SiliconFlowRerankerError(
                f"SiliconFlow rerank API returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise SiliconFlowRerankerError(
                f"Could not reach SiliconFlow rerank API: {exc}"
            ) from exc

        try:
            raw_results: Any = response.json()["results"]
            if not isinstance(raw_results, list):
                raise TypeError("results is not a list")
            scored: list[tuple[int, float]] = []
            seen: set[int] = set()
            for item in raw_results:
                index = item["index"]
                score = float(item["relevance_score"])
                if isinstance(index, bool) or not isinstance(index, int):
                    raise TypeError("result index is not an integer")
                if index < 0 or index >= len(candidates) or index in seen:
                    raise ValueError("result index is invalid or duplicated")
                seen.add(index)
                scored.append((index, score))
        except (TypeError, KeyError, ValueError) as exc:
            raise SiliconFlowRerankerError(
                "SiliconFlow rerank response has an unexpected format"
            ) from exc

        scored.sort(key=lambda item: (-item[1], item[0]))
        return [
            SearchResult(
                score=score,
                payload=candidates[index].payload,
                id=candidates[index].id,
            )
            for index, score in scored[:top_n]
        ]

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

"""SiliconFlow's OpenAI-compatible embeddings transport."""

import asyncio
from typing import Any

import httpx


class SiliconFlowEmbeddingError(RuntimeError):
    """Raised when the SiliconFlow embedding service cannot satisfy a request."""


class SiliconFlowEmbeddingClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.siliconflow.cn/v1",
        http_client: httpx.AsyncClient | None = None,
        connect_timeout: float = 10.0,
        timeout: float = 180.0,
        overall_timeout: float = 240.0,
    ) -> None:
        self._owns_client = http_client is None
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

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        kwargs.setdefault("headers", self._headers)
        try:
            async with asyncio.timeout(self.overall_timeout):
                response = await self._client.request(method, path, **kwargs)
                response.raise_for_status()
                return response
        except TimeoutError as exc:
            raise SiliconFlowEmbeddingError(
                f"SiliconFlow embedding request timed out after {self.overall_timeout:g}s"
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise SiliconFlowEmbeddingError(
                f"SiliconFlow embedding API returned HTTP {status}"
            ) from exc
        except httpx.HTTPError as exc:
            raise SiliconFlowEmbeddingError(
                f"Could not reach SiliconFlow embedding API: {exc}"
            ) from exc

    async def list_models(self) -> list[str]:
        response = await self._request("GET", "models", params={"sub_type": "embedding"})
        try:
            return [item["id"] for item in response.json().get("data", [])]
        except (TypeError, KeyError, ValueError) as exc:
            raise SiliconFlowEmbeddingError(
                "SiliconFlow model-list response has an unexpected format"
            ) from exc

    async def embed(
        self, text: str, model: str, prefix: str = "", dimensions: int | None = None
    ) -> list[float]:
        vectors = await self.embed_many(
            [text], model=model, prefix=prefix, dimensions=dimensions
        )
        return vectors[0]

    async def embed_many(
        self,
        texts: list[str],
        model: str,
        prefix: str = "",
        dimensions: int | None = None,
    ) -> list[list[float]]:
        if not texts:
            return []
        payload: dict[str, Any] = {
            "model": model,
            "input": [f"{prefix}{text}" for text in texts],
            "encoding_format": "float",
        }
        if dimensions is not None:
            payload["dimensions"] = dimensions

        response = await self._request("POST", "embeddings", json=payload)
        try:
            items = sorted(response.json()["data"], key=lambda item: item["index"])
            vectors = [[float(value) for value in item["embedding"]] for item in items]
        except (TypeError, KeyError, ValueError) as exc:
            raise SiliconFlowEmbeddingError(
                "SiliconFlow embeddings response has an unexpected format"
            ) from exc

        if len(vectors) != len(texts):
            raise SiliconFlowEmbeddingError(
                f"SiliconFlow returned {len(vectors)} embeddings for {len(texts)} inputs"
            )
        if dimensions is not None:
            mismatches = [len(vector) for vector in vectors if len(vector) != dimensions]
            if mismatches:
                raise SiliconFlowEmbeddingError(
                    f"SiliconFlow returned dimension {mismatches[0]}, expected {dimensions}"
                )
        return vectors

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

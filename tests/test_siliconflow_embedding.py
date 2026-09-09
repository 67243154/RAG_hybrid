import json

import httpx
import pytest

from app.llm.siliconflow_embedding import (
    SiliconFlowEmbeddingClient,
    SiliconFlowEmbeddingError,
)


@pytest.mark.asyncio
async def test_embed_uses_siliconflow_openai_compatible_contract():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/embeddings"
        assert request.headers["Authorization"] == "Bearer test-key"
        payload = json.loads(request.content)
        assert payload == {
            "model": "Qwen/Qwen3-Embedding-4B",
            "input": ["Instruct: retrieve\nQuery: hello"],
            "encoding_format": "float",
            "dimensions": 3,
        }
        return httpx.Response(
            200,
            json={"data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}]},
        )

    http_client = httpx.AsyncClient(
        base_url="https://api.siliconflow.cn/v1/",
        transport=httpx.MockTransport(handler),
    )
    client = SiliconFlowEmbeddingClient(api_key="test-key", http_client=http_client)

    vector = await client.embed(
        "hello",
        model="Qwen/Qwen3-Embedding-4B",
        prefix="Instruct: retrieve\nQuery: ",
        dimensions=3,
    )

    assert vector == [0.1, 0.2, 0.3]
    await http_client.aclose()


@pytest.mark.asyncio
async def test_list_models_filters_for_embedding_models():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        assert request.url.params["sub_type"] == "embedding"
        return httpx.Response(200, json={"data": [{"id": "Qwen/Qwen3-Embedding-4B"}]})

    http_client = httpx.AsyncClient(
        base_url="https://api.siliconflow.cn/v1/",
        transport=httpx.MockTransport(handler),
    )
    client = SiliconFlowEmbeddingClient(api_key="test-key", http_client=http_client)

    assert await client.list_models() == ["Qwen/Qwen3-Embedding-4B"]
    await http_client.aclose()


@pytest.mark.asyncio
async def test_embed_rejects_unexpected_output_dimension():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"data": [{"index": 0, "embedding": [0.1, 0.2]}]}
        )
    )
    http_client = httpx.AsyncClient(
        base_url="https://api.siliconflow.cn/v1/", transport=transport
    )
    client = SiliconFlowEmbeddingClient(api_key="test-key", http_client=http_client)

    with pytest.raises(SiliconFlowEmbeddingError, match="dimension 2, expected 3"):
        await client.embed("hello", model="model", dimensions=3)

    await http_client.aclose()

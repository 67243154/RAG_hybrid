import pytest

from app.llm.prompt import build_messages
from app.evidence.section_aware import SectionAwareEvidenceBuilder
from app.retrieval.hybrid_search import SearchResult
from app.security.models import RetrievalContext
from app.reranker.cross_encoder import CrossEncoderReranker


def test_reranking_uses_headings_without_modifying_evidence():
    class Model:
        def predict(self, pairs):
            assert '星辰科技 > 工作时间' in pairs[0][1]
            return [0.9]
    reranker = CrossEncoderReranker.__new__(CrossEncoderReranker)
    reranker._model = Model()
    payload = {'heading_path': ['星辰科技', '工作时间'], 'text': '上午九点上班'}
    result = reranker.rerank('星辰科技几点上班？', [SearchResult(id='one', score=0.1, payload=payload)], 1)
    assert result[0].payload['text'] == '上午九点上班'
    assert result[0].id == 'one'


def test_support_prompt_has_one_citation_contract():
    messages = build_messages(
        '愿景是什么？', [], 'v3',
        context_serializer=lambda chunks: '授权的文档内容',
        system_prompt_suffix='Return JSON with support_ids.',
        support_id_contract=True,
    )
    assert 'support_ids' in messages[0]['content']
    assert 'CANONICAL CITATION' not in messages[0]['content']
    assert '[s.filesystem' not in messages[0]['content']
    assert 'untrusted' in messages[0]['content']
    assert '授权的文档内容' in messages[1]['content']


@pytest.mark.asyncio
async def test_expansion_does_not_merge_small_document_pages():
    chunks = [SearchResult(id=str(page), score=1.0, payload={
        'tenant_id': 'tenant-a', 'source_type': 'filesystem',
        'source_id': 'manual', 'document_version': 'v1',
        'page_number': page, 'paragraph_index': 0,
        'text': text,
    }) for page, text in [(2, '目录'), (7, '愿景正文')]]
    builder = SectionAwareEvidenceBuilder.__new__(SectionAwareEvidenceBuilder)
    builder._token_budget = 1200
    builder._scroll_source = lambda anchor, context: chunks
    result = await builder.build(chunks, RetrievalContext('tenant-a'))
    assert [block.payload['text'] for block in result.blocks] == ['目录', '愿景正文']

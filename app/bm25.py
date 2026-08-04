"""BM25 关键词检索：jieba 分词 + rank_bm25。
与向量检索互补：向量吃语义，BM25 吃精确名词。
"""
from pathlib import Path

import jieba
from rank_bm25 import BM25Okapi

# 自定义词典：让 jieba 把领域专有名词当整体，不被拆散
DICT_PATH = Path(__file__).resolve().parent.parent / "data" / "domain_dict.txt"
if DICT_PATH.exists():
    jieba.load_userdict(str(DICT_PATH))


class Bm25Index:
    def __init__(self):
        self._items: list[dict] = []          # [{text, source}]
        self._bm25: BM25Okapi | None = None

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return [
            w for w in jieba.lcut(text)
            if w.strip() and w not in " \n\t，。、；：？！“”‘’（）【】-—…"
        ]

    def rebuild(self, items: list[dict]) -> None:
        """全量重建索引。items: [{text, source}]，小文档集够用。"""
        self._items = items
        corpus = [self._tokenize(it["text"]) for it in items]
        self._bm25 = BM25Okapi(corpus) if corpus else None

    def search(self, query: str, k: int = 50) -> list[dict]:
        if not self._bm25:
            return []
        q = self._tokenize(query)
        if not q:
            return []
        scores = self._bm25.get_scores(q)
        order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        out = []
        for i in order:
            if scores[i] <= 0:                # 没有任何词命中就停
                break
            out.append({
                "text": self._items[i]["text"],
                "source": self._items[i]["source"],
                "score": round(float(scores[i]), 2),
            })
            if len(out) >= k:
                break
        return out
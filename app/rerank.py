from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

class Reranker:
    def __init__(self, model_name="BAAI/bge-reranker-base"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.eval()

    @torch.no_grad()
    def rerank(self, query, candidates, top_k=4):
        pairs = [(query, c["text"]) for c in candidates]
        inputs = self.tokenizer(pairs, padding=True, truncation=True,
                                max_length=512, return_tensors="pt")
        scores = self.model(**inputs).logits.view(-1).float()
        for c, s in zip(candidates, scores):
            c["rerank_score"] = round(float(s), 4)
        return sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)[:top_k]
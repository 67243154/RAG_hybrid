FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Production uses SiliconFlow reranking, so the image deliberately excludes
# sentence-transformers, PyTorch, and local BGE weights.
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir --index-url ${PIP_INDEX_URL} -r requirements.txt

COPY app/ ./app/
COPY prompts/ ./prompts/
# Evaluation artifacts are read-only server-side data for the operations
# console. Keep them in the image so /ui/evaluations reflects the measured
# Sprint 25 result instead of silently reporting an unavailable artifact.
COPY artifacts/ ./artifacts/

EXPOSE 8000

CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000"]

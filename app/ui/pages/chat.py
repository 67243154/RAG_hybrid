"""Chat page: ask a question, watch the answer stream in with citations
highlighted and a grounding check surfaced, expand a pipeline-trace panel
sourced directly from Jaeger. Ported from production-rag-platform's
Sprint 11/12 (streaming + citation UI, then the trace panel) — see
docs/sprint-10-plan.md for what changed vs. what ported unchanged.
"""

import os

import httpx
import pandas as pd
import streamlit as st

from app.llm.prompt import NOT_FOUND_PHRASE
from app.ui.citation_formatting import highlight_citations
from app.ui.dev_auth import auth_headers
from app.ui.sse_client import parse_sse_lines
from app.ui.trace_client import fetch_trace_spans

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
JAEGER_URL = os.environ.get("JAEGER_URL", "http://localhost:16686")

st.title("💬 知识库问答")

if "messages" not in st.session_state:
    st.session_state.messages = []  # list[{"role": str, "content": str}]

for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(highlight_citations(message["content"]))

question = st.chat_input("请输入关于已导入文档的问题")

if question:
    st.session_state.messages.append({"role": "user", "content": question})
    with st.chat_message("user"):
        st.markdown(question)

    with st.chat_message("assistant"):
        placeholder = st.empty()
        answer_parts: list[str] = []
        grounding_event: dict | None = None
        trace_id: str | None = None

        # Real token-by-token streaming: the placeholder is updated inside
        # the loop as each SSE event arrives, not after the whole response
        # is collected.
        with httpx.stream(
            "POST", f"{BACKEND_URL}/chat", json={"question": question}, timeout=120.0,
            headers=auth_headers(),
        ) as response:
            for event in parse_sse_lines(response.iter_lines()):
                if event.event == "message":
                    answer_parts.append(event.data["token"])
                    placeholder.markdown(highlight_citations("".join(answer_parts)) + "▌")
                elif event.event == "metadata":
                    trace_id = event.data.get("trace_id")
                elif event.event == "grounding":
                    grounding_event = event.data

        full_answer = "".join(answer_parts)
        placeholder.markdown(highlight_citations(full_answer))

        if grounding_event is not None:
            if not grounding_event["has_citations"]:
                if full_answer.strip() == NOT_FOUND_PHRASE:
                    # Neutral — the model honestly said it couldn't find
                    # an answer, which legitimately has no citations to
                    # check. Distinct from the case below (see
                    # docs/sprint-12-plan.md, docs/sprint-16-plan.md).
                    st.caption("ℹ️ 未检索到足以回答问题的相关资料")
                else:
                    # The model asserted something with ZERO citations
                    # backing it — per GroundingResult's own docstring
                    # this is the most dangerous hallucination shape (no
                    # citation tag at all to even question), distinct
                    # from "had citations, one was fabricated" below.
                    st.warning("⚠️ 回答中没有可验证的引用")
            elif grounding_event["grounded"]:
                st.caption(f"✅ 依据验证通过——引用：{grounding_event['citations_found']}")
            else:
                st.warning(
                    "⚠️ 回答中的部分引用无法根据检索上下文完成验证："
                    f"{grounding_event['ungrounded_citations']}"
                )

        if trace_id:
            with st.expander("🔍 处理链路"):
                spans = fetch_trace_spans(trace_id, jaeger_url=JAEGER_URL)
                step_spans = [s for s in spans if s.name != "chat_request"]
                if step_spans:
                    chart_df = pd.DataFrame(
                        {"duration_ms": [s.duration_ms for s in step_spans]},
                        index=[s.name for s in step_spans],
                    )
                    st.bar_chart(chart_df)
                    total = next((s.duration_ms for s in spans if s.name == "chat_request"), None)
                    if total is not None:
                        st.caption(f"总耗时：{total:.1f} 毫秒")
                else:
                    st.caption(
                        "Jaeger 尚未完成链路索引，请稍后再查看。"
                    )
                st.markdown(f"[在 Jaeger 中打开]({JAEGER_URL}/trace/{trace_id})")

    st.session_state.messages.append({"role": "assistant", "content": full_answer})

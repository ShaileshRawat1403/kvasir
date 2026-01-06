import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_community.chat_models import ChatOllama

from kvasir_brain import KvasirBrain


class IngestRequest(BaseModel):
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    type: str = "text"


class BatchIngestRequest(BaseModel):
    items: List[IngestRequest]


class EmailMessagePayload(BaseModel):
    subject: str = ""
    text: str = ""
    snippet: str = ""
    date: str = ""
    thread_id: str = ""
    message_id: str = ""
    from_: List[str] = Field(default_factory=list, alias="from")
    to: List[str] = Field(default_factory=list)
    cc: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class EmailIngestRequest(BaseModel):
    messages: List[EmailMessagePayload]


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    query: Optional[str] = None
    persona: Optional[str] = None
    goal: Optional[str] = None
    k: int = 4
    model: Optional[str] = None


OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "phi3")
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "4096"))
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
MEMORY_DIR = os.getenv("KVASIR_MEMORY", "kvasir_memory")

app = FastAPI(title="Kvasir Brain API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Single brain instance reused across requests.
brain = KvasirBrain(
    memory_dir=MEMORY_DIR,
    llm_model=OLLAMA_MODEL,
    embedding_model=EMBED_MODEL,
    verbose=False,
)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "model": OLLAMA_MODEL,
        "memory_dir": str(MEMORY_DIR),
    }


@app.post("/ingest")
def ingest(req: IngestRequest) -> Dict[str, Any]:
    try:
        metadata = dict(req.metadata or {})
        metadata.setdefault("type", req.type or "text")
        doc_uid = brain.ingest_text(req.content, metadata=metadata)
        return {"doc_uid": doc_uid, "type": metadata["type"]}
    except Exception as exc:  # pragma: no cover - surfaced to client
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/ingest/email")
def ingest_email(req: EmailIngestRequest) -> Dict[str, Any]:
    ingested = []
    for msg in req.messages:
        content = "\n".join(
            [
                f"Subject: {msg.subject or '(No subject)'}",
                f"From: {', '.join(msg.from_)}",
                f"To: {', '.join(msg.to)}",
                f"Cc: {', '.join(msg.cc)}",
                f"Date: {msg.date}",
                "",
                msg.text or msg.snippet or "",
            ]
        ).strip()

        metadata = {
            "type": "email",
            "thread_id": msg.thread_id,
            "message_id": msg.message_id,
            "subject": msg.subject,
            "from": msg.from_,
            "to": msg.to,
            "cc": msg.cc,
            "date": msg.date,
            **(msg.metadata or {}),
        }
        doc_uid = brain.ingest_text(content, metadata=metadata)
        ingested.append({"message_id": msg.message_id, "doc_uid": doc_uid})

    return {"count": len(ingested), "ingested": ingested}


@app.get("/search")
def search(q: str, k: int = 4) -> Dict[str, Any]:
    try:
        results = brain.recall_vectors(q, k=k)
        return {"query": q, "results": results}
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/graph")
def graph(entity: str) -> Dict[str, Any]:
    try:
        relations = brain.recall_structure(entity)
        return {"entity": entity, "relations": relations}
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/chat")
def chat(req: ChatRequest) -> Dict[str, Any]:
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages are required")

    query = req.query or next(
        (m.content for m in reversed(req.messages) if m.role == "user"), ""
    )

    vector_hits = brain.recall_vectors(query, k=max(2, req.k))
    graph_hits = brain.recall_structure(query)

    context_lines = []
    for idx, doc in enumerate(vector_hits, start=1):
        meta = doc.get("metadata", {}) or {}
        title = meta.get("title") or meta.get("subject") or meta.get("type") or f"doc-{idx}"
        context_lines.append(f"[{idx}] {title}: {doc.get('content', '')}")

    if graph_hits:
        context_lines.append("RELATIONS:")
        for rel in graph_hits:
            context_lines.append(f"- {rel['subject']} -[{rel['predicate']}]-> {rel['object']}")

    context_blob = "\n".join(context_lines) or "No context found."

    system_parts = [
        "You are Kvasir, a knowledge-grounded assistant.",
        "Use the provided context to answer. If context is missing, say so briefly.",
    ]
    if req.persona:
        system_parts.append(f"Persona: {req.persona}")
    if req.goal:
        system_parts.append(f"Goal: {req.goal}")
    system = "\n".join(system_parts)

    user_prompt = "\n\n".join(
        [
          "Context:",
          context_blob,
          "Conversation:",
          "\n".join(f"{m.role}: {m.content}" for m in req.messages),
        ]
    )

    try:
        model_name = req.model or OLLAMA_MODEL
        llm = (
            brain.llm
            if model_name == OLLAMA_MODEL
            else ChatOllama(model=model_name, temperature=0.3, num_ctx=OLLAMA_NUM_CTX)
        )
        completion = llm.invoke(
            [
                SystemMessage(content=system),
                HumanMessage(content=user_prompt),
            ],
        )
        answer = getattr(completion, "content", str(completion))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "answer": answer,
        "context": {"vectors": vector_hits, "graph": graph_hits},
        "query": query,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("python_api:app", host="0.0.0.0", port=int(os.getenv("PY_API_PORT", "8000")), reload=True)

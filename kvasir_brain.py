from __future__ import annotations

import json
import mailbox
import re
import uuid
from datetime import datetime
from email import policy
from email.message import Message
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import networkx as nx
from chromadb.utils import embedding_functions
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.chat_models import ChatOllama
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.vectorstores import Chroma


TRIPLE_PROMPT = """You are a precise information extraction system.
Given a piece of text, extract concise triples that describe facts or relationships.

Rules:
- Output only triples, nothing else.
- Each triple must be on its own line as Subject|Predicate|Object.
- Use short predicate verbs in uppercase (e.g., HAS_SENTIMENT, NEEDS, BLOCKED_BY, OWNS).
- If there is nothing to extract, return NONE.
- Keep subjects and objects concise but meaningful; avoid pronouns.
- Extract at most {max_triples} triples.

TEXT:
{text}
"""


class KvasirBrain:
    def __init__(
        self,
        memory_dir: str | Path = "kvasir_memory",
        llm_model: str = "phi3",
        embedding_model: str = "nomic-embed-text",
        max_triples: int = 10,
        use_chroma_default_embeddings: bool = False,
        verbose: bool = False,
    ) -> None:
        self.verbose = verbose
        self.memory_dir = Path(memory_dir)
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.chroma_path = self.memory_dir / "chroma"
        self.graph_path = self.memory_dir / "graph.json"
        self.max_triples = max_triples

        if use_chroma_default_embeddings:
            self.embedding = embedding_functions.DefaultEmbeddingFunction()
            embedding_fn = self.embedding
        else:
            self.embedding = OllamaEmbeddings(model=embedding_model)
            embedding_fn = self.embedding

        if self.verbose:
            embed_name = (
                "chroma-default" if use_chroma_default_embeddings else embedding_model
            )
            print(
                f"🧠 KvasirBrain init | memory_dir={self.memory_dir} llm={llm_model} embeddings={embed_name}"
            )

        self.vector_store = Chroma(
            collection_name="kvasir_text",
            embedding_function=embedding_fn,
            persist_directory=str(self.chroma_path),
        )

        try:
            self.llm = ChatOllama(model=llm_model, temperature=0)
        except Exception as exc:
            raise RuntimeError(
                f"Ollama model '{llm_model}' is unavailable. Is Ollama running?"
            ) from exc

        prompt = ChatPromptTemplate.from_template(TRIPLE_PROMPT)
        self.triple_chain = prompt | self.llm | StrOutputParser()

        self.graph: nx.MultiDiGraph = self._load_graph()

    def ingest_file(self, filepath: str | Path) -> None:
        path = Path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"Missing file: {filepath}")

        suffix = path.suffix.lower()
        if suffix == ".eml":
            self._ingest_eml(path)
        elif suffix == ".mbox":
            self._ingest_mbox(path)
        elif suffix in {".txt", ".md"}:
            self._ingest_note(path)
        else:
            raise ValueError(f"Unsupported file type: {suffix}")

    def ingest_text(self, content: str, metadata: Dict[str, Any]) -> str:
        """
        Ingests arbitrary text with provided metadata into vector and graph stores.
        Returns the UID assigned to the document.
        """
        metadata = dict(metadata)
        metadata.setdefault("type", "text")
        metadata.setdefault("ingested_at", datetime.utcnow().isoformat())
        doc_uid = self._store_text(content, metadata)
        triples = self._extract_triples(content)
        if triples:
            self._update_graph(triples, source_uid=doc_uid)
        return doc_uid

    # Backwards-compatible alias mirroring the user's original API.
    ingest_data = ingest_text

    def recall_vectors(self, query: str, k: int = 4) -> List[Dict[str, object]]:
        docs = self.vector_store.similarity_search(query, k=k)
        return [
            {"content": doc.page_content, "metadata": doc.metadata} for doc in docs
        ]

    def recall_structure(self, entity: str) -> List[Dict[str, str]]:
        node_id = self._normalize_label(entity)
        if node_id not in self.graph:
            return []

        results = []
        for src, _, data in self.graph.in_edges(node_id, data=True):
            results.append(
                {
                    "subject": self.graph.nodes[src].get("label", src),
                    "predicate": data.get("predicate", ""),
                    "object": self.graph.nodes[node_id].get("label", node_id),
                }
            )
        for _, target, data in self.graph.out_edges(node_id, data=True):
            results.append(
                {
                    "subject": self.graph.nodes[node_id].get("label", node_id),
                    "predicate": data.get("predicate", ""),
                    "object": self.graph.nodes[target].get("label", target),
                }
            )
        return results

    def generate_briefing(
        self, topic: str, target_person: str, goal: str, n_results: int = 3
    ) -> Dict[str, str]:
        """
        Phase 2 helper: assemble facts, profile, and a suggested script.
        """
        vector_hits = self.recall_vectors(topic, k=n_results)
        vector_text = "\n---\n".join(doc["content"] for doc in vector_hits) or "No matching documents."

        graph_relations = self.recall_structure(target_person) + self.recall_structure(
            topic
        )
        seen: set[str] = set()
        graph_lines: List[str] = []
        for rel in graph_relations:
            line = f"{rel['subject']} -[{rel['predicate']}]-> {rel['object']}"
            if line not in seen:
                seen.add(line)
                graph_lines.append(line)
        graph_text = "\n".join(graph_lines) or "No structured relations found."

        profile_docs = self.recall_vectors(target_person, k=max(5, n_results))
        profile_context = [doc["content"] for doc in profile_docs]
        profile = self._analyze_profile(target_person, profile_context)

        fact_sheet = f"Context from Files:\n{vector_text}\n\nStructured Connections:\n{graph_text}"
        script = self._draft_script(target_person, profile, fact_sheet, goal)

        return {"facts": fact_sheet, "profile": profile, "script": script}

    def _ingest_note(self, path: Path) -> None:
        raw = path.read_text(encoding="utf-8")
        cleaned = self._clean_markdown(raw)
        metadata = {
            "type": "note",
            "title": path.stem,
            "source_path": str(path),
            "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "uid": f"note-{uuid.uuid4()}",
        }
        text_for_store = f"Title: {metadata['title']}\nUpdated: {metadata['modified']}\n\n{cleaned}"
        doc_uid = self._store_text(text_for_store, metadata)
        triples = self._extract_triples(text_for_store)
        if triples:
            self._update_graph(triples, source_uid=doc_uid)

    def _ingest_eml(self, path: Path) -> None:
        parser = BytesParser(policy=policy.default)
        message = parser.parse(path.open("rb"))
        self._process_email_message(message, path)

    def _ingest_mbox(self, path: Path) -> None:
        mbox = mailbox.mbox(path)
        for idx, message in enumerate(mbox):
            self._process_email_message(message, path, idx)

    def _process_email_message(
        self, message: Message, source_path: Path, mbox_index: int | None = None
    ) -> None:
        subject = self._clean_subject(message.get("Subject", "") or "")
        sender = (message.get("From") or "").strip()
        recipients = ", ".join(message.get_all("To", []) or [])
        date_header = message.get("Date")
        date_iso = ""
        if date_header:
            try:
                date_iso = parsedate_to_datetime(str(date_header)).isoformat()
            except Exception:
                date_iso = ""

        body = self._extract_email_body(message)
        body = self._clean_email_body(body)

        metadata = {
            "type": "email",
            "subject": subject,
            "from": sender,
            "to": recipients,
            "date": date_header or "",
            "source_path": str(source_path),
            "uid": f"email-{uuid.uuid4()}",
        }
        if mbox_index is not None:
            metadata["mbox_index"] = mbox_index

        text_for_store = (
            f"Subject: {subject}\nFrom: {sender}\nTo: {recipients}\nDate: {date_iso or date_header or 'unknown'}\n\n{body}"
        )
        doc_uid = self._store_text(text_for_store, metadata)
        triples = self._extract_triples(text_for_store)
        if triples:
            self._update_graph(triples, source_uid=doc_uid)

    def _store_text(self, text: str, metadata: Dict[str, object]) -> str:
        uid = str(metadata.get("uid") or metadata.get("id") or f"doc-{uuid.uuid4()}")
        metadata["uid"] = uid
        self.vector_store.add_texts(texts=[text], metadatas=[metadata], ids=[uid])
        self.vector_store.persist()
        return uid

    def _extract_triples(self, text: str) -> List[Tuple[str, str, str]]:
        try:
            response = self.triple_chain.invoke(
                {"text": text, "max_triples": self.max_triples}
            )
            return self._parse_triples(response)
        except Exception as exc:  # pragma: no cover - defensive against missing model/server
            if self.verbose:
                print(
                    f"[warn] Triple extraction skipped (LLM unavailable?): {exc}"
                )
            return []

    def _parse_triples(self, response: str) -> List[Tuple[str, str, str]]:
        triples: List[Tuple[str, str, str]] = []
        if not response or response.strip().upper() == "NONE":
            return triples

        raw_lines = []
        for line in response.splitlines():
            if " AND " in line:
                raw_lines.extend(part.strip() for part in line.split(" AND ") if part.strip())
            else:
                raw_lines.append(line.strip())

        for line in raw_lines:
            if "|" not in line:
                continue
            parts = [part.strip() for part in line.split("|")]
            if len(parts) != 3:
                continue
            subj, pred, obj = parts
            if subj and pred and obj:
                triples.append((subj, pred, obj))
        return triples

    def _update_graph(
        self, triples: Iterable[Tuple[str, str, str]], source_uid: str | None = None
    ) -> None:
        for subj, pred, obj in triples:
            subj_id = self._normalize_label(subj)
            obj_id = self._normalize_label(obj)

            if subj_id not in self.graph:
                self.graph.add_node(subj_id, label=subj)
            if obj_id not in self.graph:
                self.graph.add_node(obj_id, label=obj)

            is_duplicate = any(
                data.get("predicate") == pred and target == obj_id
                for _, target, data in self.graph.out_edges(subj_id, data=True)
            )
            if not is_duplicate:
                edge_data = {"predicate": pred}
                if source_uid:
                    edge_data["source_uid"] = source_uid
                self.graph.add_edge(subj_id, obj_id, **edge_data)

        self._persist_graph()

    def _analyze_profile(self, name: str, context_texts: List[str]) -> str:
        joined = "\n---\n".join(context_texts) if context_texts else "No specific history found."
        prompt = ChatPromptTemplate.from_template(
            """
You are an expert Behavioral Psychologist.
Analyze the following text snippets associated with {name}.

Determine:
1. Communication style (direct, passive, verbose, etc.)
2. Emotional state or sentiments in past interactions.
3. Potential triggers or concerns.

Text History:
{context}

Profile Summary:
"""
        )
        chain = prompt | self.llm | StrOutputParser()
        return chain.invoke({"name": name, "context": joined})

    def _draft_script(
        self, target: str, profile: str, facts: str, goal: str
    ) -> str:
        prompt = ChatPromptTemplate.from_template(
            """
You are Kvasir, a concise and strategic communicator.

Target: {target}
Target Profile: {profile}

Relevant Facts/Context:
{facts}

User Goal: {goal}

Task:
Write a short script for the user to say or email to the target.
Align tone to the target's profile (if they are direct, be concise; if stressed, be empathetic).
Use the facts to support the argument.

Script:
"""
        )
        chain = prompt | self.llm | StrOutputParser()
        return chain.invoke(
            {"target": target, "profile": profile, "facts": facts, "goal": goal}
        )

    def _normalize_label(self, text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        return text.lower()

    def _extract_email_body(self, message: Message) -> str:
        if message.is_multipart():
            for part in message.walk():
                content_type = part.get_content_type()
                if content_type == "text/plain":
                    try:
                        return part.get_content().strip()
                    except Exception:
                        continue
        try:
            return (message.get_content() or "").strip()
        except Exception:
            return ""

    def _clean_subject(self, subject: str) -> str:
        subject = subject.strip()
        subject = re.sub(r"^(re:|fwd:)\s*", "", subject, flags=re.IGNORECASE)
        return subject

    def _clean_email_body(self, body: str) -> str:
        lines = body.splitlines()
        cleaned_lines: List[str] = []
        signature_triggers = {"--", "__", "thanks,", "regards,", "cheers,", "best,", "sincerely,"}
        for line in lines:
            stripped = line.strip()
            if stripped.startswith(">"):
                continue
            if re.match(r"^on .+ wrote:$", stripped, flags=re.IGNORECASE):
                continue
            if stripped.lower().startswith("forwarded message"):
                continue
            if stripped.lower() in signature_triggers:
                break
            cleaned_lines.append(line)
        cleaned = "\n".join(cleaned_lines)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        return cleaned

    def _clean_markdown(self, text: str) -> str:
        text = re.sub(r"`{1,3}.*?`{1,3}", "", text, flags=re.DOTALL)
        text = re.sub(r"[_*#>-]{1,3}", "", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _load_graph(self) -> nx.MultiDiGraph:
        if not self.graph_path.exists():
            return nx.MultiDiGraph()

        data = json.loads(self.graph_path.read_text(encoding="utf-8"))
        graph = nx.MultiDiGraph()
        for node in data.get("nodes", []):
            graph.add_node(node["id"], **node.get("data", {}))
        for edge in data.get("edges", []):
            graph.add_edge(edge["source"], edge["target"], **edge.get("data", {}))
        return graph

    def _persist_graph(self) -> None:
        payload = {
            "nodes": [
                {"id": node_id, "data": data}
                for node_id, data in self.graph.nodes(data=True)
            ],
            "edges": [
                {"source": src, "target": tgt, "data": data}
                for src, tgt, data in self.graph.edges(data=True)
            ],
        }
        self.graph_path.parent.mkdir(parents=True, exist_ok=True)
        self.graph_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


__all__ = ["KvasirBrain"]

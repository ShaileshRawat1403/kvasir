from __future__ import annotations

import mailbox
import os
import re
import uuid
from datetime import datetime
from email import policy
from email.message import Message
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from chromadb.utils import embedding_functions
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.chat_models import ChatOllama
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from neo4j import GraphDatabase, Driver


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

RESOLUTION_PROMPT = """You are an intelligent entity resolution system. Your task is to determine if a "New Entity" is the same as any of the "Existing Entities" from a knowledge graph.
The entities can be people, projects, companies, or abstract concepts.
Focus on semantic meaning, not just string similarity. For example, "Dr. Jane" and "Jane Smith" are likely the same person, but "Project Alpha" and "Project Beta" are not.

New Entity:
{new_entity}

Existing Entities:
{existing_entities}

Question:
Which of the "Existing Entities" is the best match for the "New Entity"?
Respond with the single best matching name from the "Existing Entities" list. If there is no clear match, respond with the word NONE.
"""


class Neo4jGraph:
    def __init__(self, driver: Driver, resolution_chain, verbose: bool = False):
        self.driver = driver
        self.resolution_chain = resolution_chain
        self.verbose = verbose
        self.apoc_available = False
        self._ensure_constraints()
        self._check_apoc()

    def _ensure_constraints(self) -> None:
        """Ensure uniqueness constraints are set for Entity nodes on the label property."""
        with self.driver.session() as session:
            try:
                session.run("DROP CONSTRAINT IF EXISTS ON (n:Entity) REQUIRE n.name IS UNIQUE")
            except Exception:
                # Already dropped or not present.
                pass
            session.run("CREATE CONSTRAINT IF NOT EXISTS FOR (n:Entity) REQUIRE n.label IS UNIQUE")

    def _check_apoc(self) -> None:
        """Detect whether APOC is available for helper functions."""
        try:
            with self.driver.session() as session:
                session.run("RETURN apoc.text.levenshteinDistance('a','b') AS d").single()
                session.run("RETURN apoc.coll.union([1], [2]) AS u").single()
            self.apoc_available = True
        except Exception:
            self.apoc_available = False
            if self.verbose:
                print("⚠️  APOC not available; falling back to simpler graph operations (no fuzzy matching).")

    def _resolve_entity(self, label: str, session=None, cache: Dict[str, str] | None = None) -> str:
        """Finds or creates a canonical entity label."""
        if not label:
            return ""

        if cache is not None and label in cache:
            return cache[label]

        own_session = False
        if session is None:
            session = self.driver.session()
            own_session = True

        try:
            result = session.run(
                "MATCH (e:Entity) WHERE e.aliases IS NOT NULL AND $label IN e.aliases RETURN e.label",
                label=label,
            ).single()
            if result:
                resolved = result["e.label"]
                if cache is not None:
                    cache[label] = resolved
                return resolved

            # Step 2: Find candidates for resolution
            find_candidates_query = """
            MATCH (e:Entity)
            WHERE apoc.text.levenshteinDistance(e.label, $label) < 4
            RETURN e.label AS label
            LIMIT 5
            """
            if not self.apoc_available:
                find_candidates_query = """
                MATCH (e:Entity)
                WHERE toLower(e.label) CONTAINS toLower($label) OR toLower($label) CONTAINS toLower(e.label)
                RETURN e.label AS label
                LIMIT 5
                """
            candidates = [row["label"] for row in session.run(find_candidates_query, label=label)]
        except Exception as e:
            if self.verbose:
                print(f"Entity resolution lookup failed for '{label}': {e}")
            candidates = []
        finally:
            if own_session:
                session.close()

        if not candidates:
            if cache is not None:
                cache[label] = label
            return label

        # Step 3: Ask LLM for resolution
        try:
            resolved_name = self.resolution_chain.invoke({
                "new_entity": label,
                "existing_entities": "\n".join(f"- {c}" for c in candidates)
            }).strip()

            if self.verbose:
                print(f"Resolving '{label}': candidates={candidates}, chosen='{resolved_name}'")

            if resolved_name != "NONE" and resolved_name in candidates:
                if cache is not None:
                    cache[label] = resolved_name
                return resolved_name # Return the canonical label of the matched entity

        except Exception as e:
            if self.verbose:
                print(f"Entity resolution LLM call failed: {e}")

        if cache is not None:
            cache[label] = label
        return label # Default to original label if no match or on error

    def update_graph(self, triples: Iterable[Tuple[str, str, str]], source_uid: str | None = None) -> None:
        """
        Resolves entities and merges triples into the Neo4j graph.
        """
        triples_list = list(triples)
        if not triples_list:
            return

        resolution_cache: Dict[str, str] = {}
        batch: List[Dict[str, str]] = []

        with self.driver.session() as session:
            for subj_original, pred, obj_original in triples_list:
                subj_canonical = self._resolve_entity(subj_original, session=session, cache=resolution_cache)
                obj_canonical = self._resolve_entity(obj_original, session=session, cache=resolution_cache)
                batch.append(
                    {
                        "subj_canonical": subj_canonical,
                        "subj_original": subj_original,
                        "obj_canonical": obj_canonical,
                        "obj_original": obj_original,
                        "predicate": pred,
                        "source_uid": source_uid,
                    }
                )

            if not batch:
                return

            alias_union = (
                "apoc.coll.union(coalesce({alias}, []), [t.{original}])"
                if self.apoc_available
                else "coalesce({alias}, []) + [t.{original}]"
            )
            subj_alias_expr = alias_union.format(alias="subj.aliases", original="subj_original")
            obj_alias_expr = alias_union.format(alias="obj.aliases", original="obj_original")

            merge_query = f"""
            UNWIND $batch AS t
            MERGE (subj:Entity {{label: t.subj_canonical}})
            ON CREATE SET subj.aliases = [t.subj_original]
            ON MATCH SET subj.aliases = {subj_alias_expr}

            MERGE (obj:Entity {{label: t.obj_canonical}})
            ON CREATE SET obj.aliases = [t.obj_original]
            ON MATCH SET obj.aliases = {obj_alias_expr}

            MERGE (subj)-[rel:RELATES_TO {{predicate: t.predicate}}]->(obj)
            ON CREATE SET rel.source_uid = t.source_uid
            """
            session.run(merge_query, batch=batch)

        if self.verbose:
            print(f"Updated graph with {len(batch)} triples (with entity resolution).")

    def get_relations(self, entity: str) -> List[Dict[str, str]]:
        """
        Recall all relationships for an entity, searching by label or alias.
        Performs simple normalization so "Project Alpha" and "Project_Alpha"
        both match stored nodes.
        """
        if not entity:
            return []

        normalized = entity.strip()
        underscored = normalized.replace(" ", "_")
        spaced = normalized.replace("_", " ")

        query = """
        MATCH (n:Entity)
        WHERE
          toLower(n.label) = toLower($normalized) OR
          toLower(n.label) = toLower($underscored) OR
          toLower(replace(n.label, '_', ' ')) = toLower($spaced) OR
          toLower($normalized) IN [x IN coalesce(n.aliases, []) | toLower(x)] OR
          toLower($underscored) IN [x IN coalesce(n.aliases, []) | toLower(x)] OR
          toLower($spaced) IN [x IN coalesce(n.aliases, []) | toLower(x)]
        OPTIONAL MATCH (n)-[r]->(obj)
        OPTIONAL MATCH (subj)-[r2]->(n)
        WITH n,
             COLLECT(DISTINCT {subject: n.label, predicate: r.predicate, object: obj.label}) AS outgoing,
             COLLECT(DISTINCT {subject: subj.label, predicate: r2.predicate, object: n.label}) AS incoming
        RETURN outgoing, incoming
        """
        with self.driver.session() as session:
            result = session.run(
                query,
                normalized=normalized,
                underscored=underscored,
                spaced=spaced,
            ).single()
            if not result:
                return []

            relations = [
                rel
                for rel in result["outgoing"]
                if rel["subject"] and rel["predicate"] and rel["object"]
            ]
            relations.extend(
                [
                    rel
                    for rel in result["incoming"]
                    if rel["subject"] and rel["predicate"] and rel["object"]
                ]
            )
            return relations

    def close(self) -> None:
        if self.driver:
            self.driver.close()


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

        triple_prompt = ChatPromptTemplate.from_template(TRIPLE_PROMPT)
        self.triple_chain = triple_prompt | self.llm | StrOutputParser()

        resolution_prompt = ChatPromptTemplate.from_template(RESOLUTION_PROMPT)
        self.resolution_chain = resolution_prompt | self.llm | StrOutputParser()

        try:
            uri = os.environ["NEO4J_URI"]
            user = os.environ["NEO4J_USER"]
            password = os.environ["NEO4J_PASSWORD"]
            driver = GraphDatabase.driver(uri, auth=(user, password))
            driver.verify_connectivity()
            self.graph = Neo4jGraph(driver, resolution_chain=self.resolution_chain, verbose=self.verbose)
            if self.verbose:
                print(f"🔗 Connected to Neo4j at {uri}")
        except (KeyError, Exception) as exc:
            raise RuntimeError(
                "Neo4j connection failed. Ensure NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are set."
            ) from exc

    def __del__(self) -> None:
        self.close()

    def close(self) -> None:
        if hasattr(self, "graph") and self.graph:
            self.graph.close()

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
            self.graph.update_graph(triples, source_uid=doc_uid)
        return doc_uid

    # Backwards-compatible alias mirroring the user's original API.
    ingest_data = ingest_text

    def recall_vectors(self, query: str, k: int = 4) -> List[Dict[str, object]]:
        docs = self.vector_store.similarity_search(query, k=k)
        return [
            {"content": doc.page_content, "metadata": doc.metadata} for doc in docs
        ]

    def recall_structure(self, entity: str) -> List[Dict[str, str]]:
        return self.graph.get_relations(entity)

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
            self.graph.update_graph(triples, source_uid=doc_uid)

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
            self.graph.update_graph(triples, source_uid=doc_uid)

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


__all__ = ["KvasirBrain"]

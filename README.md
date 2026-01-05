# Kvasir – Phase 1

Local-first ingestion and knowledge extraction built around ChromaDB (vector memory), NetworkX (graph memory), and Phi-3 via Ollama (triple extraction).

## Setup
- Install dependencies: `python3 -m venv .venv && source .venv/bin/activate` then `pip install -r requirements.txt`
- Make sure an Ollama server is running with the `phi3` and `nomic-embed-text` models pulled.

## Core class
`kvasir_brain.py` exposes `KvasirBrain`:
- `ingest_file(filepath)`: accepts `.eml`, `.mbox`, `.txt`, `.md`; cleans text, stores chunks in Chroma (`./kvasir_memory/chroma`) and updates the graph (`./kvasir_memory/graph.json`) using triple extraction.
- `ingest_text(content, metadata)` / `ingest_data(...)`: ingest arbitrary text with metadata (useful for programmatic pipelines).
- `recall_vectors(query, k=4)`: semantic search over stored text.
- `recall_structure(entity)`: neighbors from the graph with simple lowercase normalization for entity matching.
- `generate_briefing(topic, target_person, goal)`: optional Phase 2 helper that composes a fact sheet, profile, and suggested script using the stored vectors/graph plus Phi-3.

Extraction prompt expects strictly `Subject|Predicate|Object` lines; predicates are uppercase verbs. Signatures/forward headers and markdown noise are stripped before extraction.

## Demo
- Sample data sits in `sample_data/` (3 emails, 1 note).
- Run `python3 run_demo.py` to ingest the samples, print graph nodes/edges, and show recall examples.

## Frontend UI (React)
- Location: `frontend/` (Vite + React + lucide icons, Tailwind via CDN).
- Install: `cd frontend && npm install`
- Develop: `npm run dev` (serves on port 5173)
- Build: `npm run build` (outputs to `frontend/dist`)
- Entry: `frontend/src/App.jsx` contains the persona panel + chat UI you provided.

## Local LLM proxy (Node + Ollama)
- Location: root `server.js` (Express proxy to Ollama).
- Install deps: `npm install` (root).
- Run: `npm start` (starts on port 3030).
- Requires Ollama running locally with the target model (default `phi3`) available at `http://localhost:11434`.
- Frontend expects `VITE_API_BASE` (see `.env.example`); default is `http://localhost:3030`.

## Email IMAP integration
- Configure `.env` (see `.env.example`) with `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS`, `IMAP_TLS`, and optional `IMAP_MAILBOX` (defaults to `INBOX`).
- The proxy exposes `/api/email/threads`, `/api/email/thread/:id`, `/api/email/summary`, and `/api/email/draft`, using Ollama for summarization and drafting.
- In the frontend, open the left sidebar → Email to load threads, view summaries, and generate drafts with the selected persona and goal.
- Email cache and summaries persist to `kvasir_memory/email_cache.json`; remove it to force a fresh sync.

## Make targets
- `make install` — create venv and install Python deps.
- `make demo` — run the sample ingestion + graph printout.
- `make frontend-install` — install frontend dependencies.
- `make frontend-dev` — start the React dev server (port 5173).
- `make frontend-build` — build the frontend bundle.
- `make clean-memory` — remove persisted vector/graph data in `kvasir_memory/`.
- `make backend-install` — install Node proxy deps (Express/CORS).
- `make backend-start` — run the Node proxy to Ollama.
- Aliases: `bi` (backend-install), `bs` (backend-start), plus existing short forms (`v`, `pi`, `d`, `fi`, `fd`, `fb`, `cm`).

## Storage layout
- Vector memory: `./kvasir_memory/chroma`
- Graph ledger: `./kvasir_memory/graph.json`

## Notes
- Embeddings default to `nomic-embed-text` via Ollama; pass `use_chroma_default_embeddings=True` to `KvasirBrain` if you prefer Chroma's built-in embedding function.
- The Phase 2 briefing helpers reuse the same Ollama chat model (`phi3` by default). Ensure Ollama is running before invoking them.

# Context-docs ingestion (MKBank assistant corpus) — design

**Date:** 2026-06-20
**Status:** approved (two tradeoffs decided via clarifying questions)
**Goal:** Ingest `docs/context-docs/` into the live Milvus vector store **and** the
Neo4j knowledge graph, as the grounding corpus for a future **mkbank assistant**
fork. Deliver a committed, idempotent, resumable batch ingester that travels with
the fork.

## Corpus (authoritative inventory, 2026-06-20)

| Group (dir) | Segment id | Count | Format |
|---|---|---|---|
| `Микро ва Кичик Бизнес` | `micro_small` | 10 | 6 docx + 4 pdf |
| `Ўрта ва Йирик Бизнес` | `medium_large` | 6 | docx |
| `lex.uz` | `cb_legal` | 130 | md (Uzbek Cyrillic) |
| `lex.uz/Барча_…бирлаштирилган.md` | — | 1 | **skipped** (concatenation of the 130) |

Total candidate docs: **146** (before the in-force filter on the legal set).

## Decisions

1. **Enrichment: full, default model.** Both per-chunk LLM passes run with the
   default chat model (`gpt-5.4`): Anthropic-style contextual-retrieval prefixing
   (`chunking.contextualize`) **and** Neo4j entity/relationship extraction
   (`Neo4jGraphStore.add_chunks`). Best retrieval quality + richest KB.
2. **Scope: products + in-force legal.** All 16 product docs, plus only the
   currently-relevant legal acts. Annual activity reports, repeal/invalidation
   decrees, and parliamentary/informational items are dropped by a **filename
   heuristic**. The heuristic is surfaced as a kept/dropped manifest at
   `--dry-run` for human approval before any write.

## Target stores

There is no local data plane; `.env` points Milvus (`100.81.83.18:19530`) and
Neo4j (`:7687`) at the **live Mac Mini**. Ingesting populates prod (corpus is
currently empty). Both `ENABLE_CONTEXTUAL_RETRIEVAL` and
`ENABLE_GRAPH_RETRIEVAL` are on.

## Constraints discovered in the stores

- Milvus persists only `title` + `source_uri` as chunk metadata (no JSON field);
  `segment`/`language` cannot be stored as separate fields without a schema
  migration + re-embed (out of scope). They are folded into the human `title`
  where useful.
- `doc_id` VARCHAR is capped at **64 chars** → use an ASCII hash-based id.
- `chunk_document` emits **uuid4** chunk_ids (non-deterministic) → idempotency is
  achieved at the document level via delete-by-`doc_id` (`--replace`), not chunk
  upsert.
- macOS stores filenames in **NFD**; the in-force filter must
  `unicodedata.normalize("NFC", …)` before regex matching or Cyrillic patterns
  silently fail to match.

## Components

### `src/sovereign_rag/ingestion/context_docs.py` (pure, unit-tested, no I/O)
- `SEGMENTS: dict[str, str]` — directory name → segment id.
- `@dataclass SourceSpec`: `path`, `segment`, `doc_id`, `title`, `source_uri`,
  `is_markdown`, `drop_reason: str | None`.
- `IN_FORCE_DROP_RULES: list[tuple[str, re.Pattern]]` — `(reason, pattern)`,
  matched against the NFC-normalized filename stem:
  - `repeal_decree`: `ўз кучини йўқотган деб топиш`
  - `annual_report`: `фаолияти тўғрисидаги ҳисобот` | `юзасидан.{0,8}ҳисобот`
  - `info_item`: `борасида амалга оширилаётган ишлар` | `парламент`
  (Specifically does **not** drop normative acts that merely contain `ҳисобот`,
  e.g. "молиявий ҳисоботларни … тақдим этиш тартиби тўғрисидаги низом".)
- `doc_id_for(rel_path) -> str` → `f"ctx-{segment}-{sha1(nfc(rel_path))[:10]}"`
  (≤ 64, ASCII, stable).
- `title_for(spec)` — NFC filename stem; product docs get a short segment tag
  prefix (e.g. `"[Микро/Кичик] …"`).
- `source_uri_for(path, md_text) -> str` — for legal md, extract the first-line
  `[…](https://lex.uz/…)` link; else `file://<abs>`.
- `discover(root, *, only, include_superseded) -> list[SourceSpec]` — walk the
  tree, skip `.DS_Store` + the combined `Барча_*` file, assign segment, apply the
  in-force filter (tagging `drop_reason`), honor `only`/`include_superseded`.

### `scripts/ingest_context_docs.py` (orchestration, I/O)
- Flags: `--root`, `--dry-run`, `--replace`, `--only {all,products,legal}`,
  `--include-superseded`, `--limit N`, `--progress-file`.
- Flow: `discover` → print manifest (kept N + dropped M grouped by reason) →
  on `--dry-run` stop after also reporting parse/chunk counts for a sample.
- Per kept spec: build `SourceDocument` (md → read + NFC; docx/pdf → `parse_file`
  / Docling), set `doc_id`/`title`/`source_uri`/`metadata{segment,language:"uz"}`,
  then `pipe.index_document(doc, with_context=True, with_graph=True)`.
- **Resumable:** a JSON progress file records successfully-ingested `doc_id`s;
  re-runs skip them. `--replace` ignores the progress file and deletes-then-
  reindexes each doc.
- Robust: per-doc try/except → log + record failure, continue; summary at end.

### Tests `tests/test_context_docs_ingestion.py` (hermetic, no network)
- `discover` on a tmp tree: skips `.DS_Store` + combined; correct segments.
- In-force filter drops reports/repeals/info, keeps normative low — with both
  **NFC and NFD** filename inputs.
- `source_uri_for` extracts lex.uz link from md first line; falls back to file://.
- `doc_id_for` is stable, ASCII, ≤ 64 chars.

## Out of scope / future
- Persisting `segment`/`language` as first-class Milvus fields (needs a schema
  migration + re-embed).
- Consolidating amendment chains (base + `-1…-N` amendments) — all kept as-is.
- The RAG eval over this now-non-empty corpus (separate, deferred task).

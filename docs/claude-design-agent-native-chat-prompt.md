# claude.ai/design prompt — Sovereign RAG: agent-native chat

> Paste the prompt below into claude.ai/design. It produces the visual treatment for the redesigned chat. Spec: `docs/superpowers/specs/2026-06-04-agent-native-chat-redesign-design.md`. After generating, download into `design/` and the implementation will match it.

---

## Prompt

Design the chat/answer screen for **Sovereign RAG**, an internal, local-first GraphRAG tool used by engineers to query a private knowledge base. The chat is driven by a **ReAct agent** that decides when to search the corpus, search the web, or answer directly. The screen must feel **answer-first ("AI-second")**: the answer is the hero; the agent's process is quiet and tucked away. It must NOT look like a generic consumer AI app — no big rounded bubbles, no playful gradients, no sparkle-everywhere. Think a precise, technical, developer-tool aesthetic.

### Design system (match exactly)
- **Type:** Inter for UI/answer text at ~14px / 1.55 line-height; **JetBrains Mono** for metadata, tool labels, scores, citation brackets. Tight, dense, technical.
- **Color:** indigo-600 (`#4f46e5`) primary accent; zinc neutrals (zinc-50→950); emerald/amber/rose for success/warn/error. **Light AND dark** themes (dark is the primary working theme).
- **Shape:** small/square-ish radii (2–8px), not pill-round. Restrained borders (1px zinc), subtle muted backgrounds for secondary surfaces.
- **Density:** compact, calm, lots of horizontal room for the answer (single column, full-width answer — no persistent right sidebar).

### Screen anatomy (one assistant turn)
1. **User message** — right-aligned, compact, square-cornered surface.
2. **Assistant answer (the hero)** — streamed markdown (headings, bold, bullet lists, inline `code`, code blocks). **Inline numeric citations** as small mono `[1]`,`[2]` chips anchored in the prose (hover → small popover with the source snippet). The answer dominates the visual weight.
3. **Process block (quiet, below or above the answer)** — ONE collapsible line per turn:
   - *Collapsed* (default after completion): a single muted mono line like `▸ searched corpus · 2 searches · 6.2s` or `▸ answered from conversation · 0.8s`. Low contrast; must not compete with the answer.
   - *Expanded* (auto-open while the agent is working): a tiny vertical timeline of tool steps — `search corpus → web search → answer` — each row = small icon + label + status (done / running… with a subtle pulse) + duration in mono. Collapses back to the summary when done.
4. **Sources disclosure** — a muted `▸ Used 5 sources` line beneath the answer; expands to a compact list: `[1] · title · doc/uri · score`, web-crawled sources marked with a small globe.
5. **Per-message actions** (appear after completion, low-key): copy, regenerate, "view trace". A small `⟐ corrected via web` provenance chip only when a web crawl contributed.
6. **Composer** (bottom, sticky): a single-line/auto-grow input `Ask anything…`, a send button, and ONE small **gear** that opens a single popover (model select · retrieve/rerank-k sliders · graph toggle). No other inline controls.

### Human-in-the-loop approval (a special turn state)
When the agent wants to read web pages it pauses for approval. Design an **intent-preview checkpoint card** (compact, inline in the transcript): a heading "The agent wants to read these pages to answer:", a checkable list of candidate URLs (favicon + domain, not full URLs), a one-line "why", and two first-class buttons **Approve** / **Decline** (decline is normal, not an error). While crawling: per-URL progress rows (crawling → indexed/failed). After: a one-line receipt `crawled 2 pages · 41 chunks` folded into the process block.

### Deliverables
Produce, for **desktop and mobile**, in **light and dark**:
- The empty state (calm: a centered composer + a few example prompts + small corpus stats).
- The five turn types: **reformat** (no process steps, no sources — "answered from conversation"), **single-hop search** (one search step + sources), **multi-hop** (`searched corpus · 3 searches`), **web-fallback** (intent-preview card → crawling → answer with provenance), and **error** (a quiet error banner with a retry).
- A streaming mid-answer state (process block expanded, answer filling in with a cursor).

Keep it token-light, structured, and trustworthy: answer first, process collapsed, provenance one click away. Avoid: chain-of-thought dumps, always-expanded pipeline diagrams, multiple competing panels, and bare OK/Cancel approvals.

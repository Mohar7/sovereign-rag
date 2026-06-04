import { useState, type ReactNode } from "react"
import { Copy } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card, CardContent } from "@/components/ui/card"
import type { CitationModel } from "@/lib/api"
import { pickKind } from "@/lib/citation-kind"
import i18n from "@/lib/i18n"

import { CitationChip, MonoTag } from "./citation-chip"

/**
 * Renders an LLM answer as proper markdown — bold, italics, inline code,
 * bullet/numbered lists, headings, fenced code — while interleaving the
 * inline ``[n]`` citation markers as CitationChips.
 *
 * Deliberately a small hand-rolled renderer rather than react-markdown: the
 * answer markdown is a predictable LLM-generated subset, and parsing it here
 * keeps citation interleaving trivial (no remark plugin) and adds no dep to an
 * already-large bundle. Anything it doesn't recognise falls through as plain
 * text, so it degrades safely.
 *
 * Visual: the "technical / dense" treatment — 14px / 1.55, square corners,
 * mono accents.
 */

interface MarkdownAnswerProps {
  answer: string
  citations: CitationModel[]
  onOpenSource?: (cite: CitationModel) => void
}

// One pass per inline run. Order matters: code first (so its contents are
// never re-parsed), then bold (**), then single-star / underscore italics,
// then the [n] citation marker. A fresh RegExp is built per render() call so
// recursion (bold containing a citation) can't corrupt a shared lastIndex.
const INLINE_SOURCE = "(`[^`]+`)|(\\*\\*[\\s\\S]+?\\*\\*)|(\\*[^*\\n]+?\\*)|(_[^_\\n]+?_)|(\\[\\d+\\])"

function renderInline(
  text: string,
  citations: CitationModel[],
  onOpenSource: ((c: CitationModel) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const out: ReactNode[] = []
  const re = new RegExp(INLINE_SOURCE, "g")
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i++}`
    if (m[1]) {
      out.push(
        /* design C: 0.86em mono, muted bg, 70% border, radius 4 */
        <code
          key={key}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.86em",
            padding: "1px 5px",
            borderRadius: 4,
            background: "var(--muted)",
            color: "var(--foreground)",
            border: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (m[2]) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInline(tok.slice(2, -2), citations, onOpenSource, key)}
        </strong>,
      )
    } else if (m[3]) {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>,
      )
    } else if (m[4]) {
      // Underscore italics are used for the low-confidence caveat note.
      out.push(
        <em key={key} className="italic text-muted-foreground">
          {tok.slice(1, -1)}
        </em>,
      )
    } else if (m[5]) {
      const n = parseInt(tok.slice(1, -1), 10)
      const cite = citations[n - 1]
      out.push(
        cite ? (
          <CitationChip
            key={key}
            n={n}
            kind={pickKind(cite)}
            doc={cite.title}
            page={cite.page ?? undefined}
            snippet={cite.snippet}
            uri={cite.source_uri}
            score={cite.score}
            onOpen={onOpenSource ? () => onOpenSource(cite) : undefined}
          />
        ) : (
          <MonoTag key={key}>[{n}]</MonoTag>
        ),
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "h"; level: number; text: string }
  | { type: "code"; code: string }

const UL_RE = /^[-*•]\s+(.*)$/
const OL_RE = /^\d+[.)]\s+(.*)$/

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ") })
      para = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (trimmed.startsWith("```")) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i])
        i++
      }
      i++ // consume closing fence
      blocks.push({ type: "code", code: code.join("\n") })
      continue
    }

    if (trimmed === "") {
      flush()
      i++
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (h) {
      flush()
      blocks.push({ type: "h", level: h[1].length, text: h[2] })
      i++
      continue
    }

    if (UL_RE.test(trimmed)) {
      flush()
      const items: string[] = []
      while (i < lines.length) {
        const mm = UL_RE.exec(lines[i].trim())
        if (!mm) break
        items.push(mm[1])
        i++
      }
      blocks.push({ type: "ul", items })
      continue
    }

    if (OL_RE.test(trimmed)) {
      flush()
      const items: string[] = []
      while (i < lines.length) {
        const mm = OL_RE.exec(lines[i].trim())
        if (!mm) break
        items.push(mm[1])
        i++
      }
      blocks.push({ type: "ol", items })
      continue
    }

    para.push(trimmed)
    i++
  }
  flush()
  return blocks
}

function CodeFenceBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  // Detect optional lang from first line (```lang)
  const lang = ""
  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    /* design CodeBlock: radius 8, border, muted bg, header with lang MonoTag + copy icon */
    <div
      style={{
        margin: "14px 0 2px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--muted)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
        }}
      >
        {lang && <MonoTag style={{ fontSize: 10.5 }}>{lang}</MonoTag>}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: copied ? "var(--primary)" : "var(--muted-foreground)",
          }}
        >
          <Copy size={12} />
        </button>
      </div>
      <pre style={{ margin: 0, padding: "12px 14px", overflow: "auto" }}>
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.65,
            color: "var(--foreground)",
            whiteSpace: "pre",
          }}
        >
          {code}
        </code>
      </pre>
    </div>
  )
}

function renderBlock(
  b: Block,
  key: string,
  citations: CitationModel[],
  onOpenSource?: (c: CitationModel) => void,
): ReactNode {
  switch (b.type) {
    case "p":
      /* design AnsP: 14px / 1.62 */
      return (
        <p key={key} style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.62, color: "var(--foreground)" }}>
          {renderInline(b.text, citations, onOpenSource, key)}
        </p>
      )
    case "ul":
      /* design AnsList: no list-disc; primary dot, gap 7, 14px / 1.55 */
      return (
        <ul
          key={key}
          style={{
            margin: "10px 0 0",
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          {b.items.map((it, j) => (
            <li
              key={j}
              style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.55, color: "var(--foreground)" }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: "var(--primary)",
                  marginTop: 8,
                }}
              />
              <span style={{ flex: 1 }}>
                {renderInline(it, citations, onOpenSource, `${key}-${j}`)}
              </span>
            </li>
          ))}
        </ul>
      )
    case "ol":
      return (
        <ol
          key={key}
          className="list-decimal space-y-1 pl-5 marker:font-mono marker:text-muted-foreground"
          style={{ fontSize: 14, lineHeight: 1.55 }}
        >
          {b.items.map((it, j) => (
            <li key={j}>
              {renderInline(it, citations, onOpenSource, `${key}-${j}`)}
            </li>
          ))}
        </ol>
      )
    case "h":
      /* design AnsH: 14.5px / 600, margin 22px top 8px bottom */
      return (
        <div
          key={key}
          style={{
            fontSize: 14.5,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            color: "var(--foreground)",
            margin: "22px 0 8px",
          }}
        >
          {renderInline(b.text, citations, onOpenSource, key)}
        </div>
      )
    case "code":
      return <CodeFenceBlock key={key} code={b.code} />

  }
}

export function MarkdownAnswer({ answer, citations, onOpenSource }: MarkdownAnswerProps) {
  if (!answer.trim()) {
    return <EmptyAnswer citations={citations} />
  }
  const blocks = parseBlocks(answer)
  return (
    /* design AnsP baseline: 14px / 1.62; first-child margin reset */
    <div
      style={{ fontSize: 14, lineHeight: 1.62, color: "var(--foreground)" }}
      className="[&>p:first-child]:mt-0"
    >
      {blocks.map((b, i) => renderBlock(b, `b-${i}`, citations, onOpenSource))}
    </div>
  )
}

function EmptyAnswer({ citations }: { citations: CitationModel[] }) {
  const { t } = useTranslation()
  if (citations.length === 0) {
    return (
      <Card className="bg-muted/50">
        <CardContent className="p-4 text-[13px] text-muted-foreground">
          {t("pages.ask.noAnswerNoSources")}
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] italic text-muted-foreground">
        {t("pages.ask.emptyAnswerFallback", { count: citations.length })}
      </p>
      <ol className="space-y-2.5">
        {citations.map((c, i) => (
          <li key={c.chunk_id} className="rounded-sm border border-border bg-card p-3">
            <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
              <span className="font-mono font-semibold text-primary">[{i + 1}]</span>
              <span className="truncate font-medium text-foreground">
                {c.title || i18n.t("common.untitled")}
              </span>
              {c.page !== null && c.page !== undefined && (
                <span className="font-mono tabular-nums">p.{c.page}</span>
              )}
              <span className="ml-auto font-mono tabular-nums">{c.score.toFixed(2)}</span>
            </div>
            <p className="mt-1.5 line-clamp-4 text-[13px] leading-[1.5] text-muted-foreground">
              {c.snippet}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}

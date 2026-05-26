"""Unit tests for the PRODUCT.md structured chunker.

Pure unit tests — no Milvus, no Neo4j, no LLM. They exercise the three
chunking strategies (prose / FAQ / table / mixed) plus the section tree
walker and the h1_path breadcrumb that ends up in chunk metadata.

The fixture markdown deliberately mimics PRODUCT.md's quirks: §-numbered
H2s, optionally-numbered H3s, FAQ ``**В:/О:**`` pairs, pipe-tables with
``**bold**`` cells, and the ``---`` thematic breaks between sections.
"""

from __future__ import annotations

import textwrap

import pytest

from sovereign_rag.ingestion.product_md import (
    chunk_product_md,
    classify_section,
    parse_sections,
)

# Keep the fixture compact but representative of every shape the real doc
# has (prose H2, FAQ H3s under an H2, pure table, glossary table, mixed).
_MD = textwrap.dedent(
    """\
    # Heading

    ## Содержание

    1. [About](#1-about)

    ---

    ## 1. О продукте

    Это короткое описание продукта. Платформа DBP BUSINESS поддерживает
    создание платёжных поручений и валютные переводы.

    Второй абзац рассказывает про роли — Сотрудник, Бухгалтер, Директор.

    ---

    ## 2. Глоссарий

    | Термин | Расшифровка |
    |---|---|
    | **ИНН** | Идентификационный номер налогоплательщика |
    | **КНП** | Код назначения платежа. По умолчанию `00668` |

    ---

    ## 8. Платёжное поручение

    ### Пошагово

    1. Откройте раздел «Платежи».
    2. Нажмите `Создать платёж`.
    3. Заполните поля.

    ### После отправки

    Документ переходит в статус `На подписи`.

    ---

    ## 27. FAQ

    ### Аутентификация

    **В: Я забыл логин.**
    О: Обратитесь в Call Center.

    **В: Не приходит СМС.**
    О: Подождите 60 секунд и попробуйте ещё раз.

    ### Платежи

    **В: Что такое КНП?**
    О: Код назначения платежа. По умолчанию `00668`.
    """
)


def test_parse_sections_skips_toc_and_extracts_leaves() -> None:
    sections = parse_sections(_MD)
    titles = [s.title for s in sections]
    # TOC ("Содержание") is dropped; the rest become leaves.
    assert "Содержание" not in titles
    # §1 and §2 are H2 leaves; §8 and §27 are containers whose H3s are leaves.
    assert "О продукте" in titles
    assert "Глоссарий" in titles
    assert "Пошагово" in titles
    assert "После отправки" in titles
    assert "Аутентификация" in titles
    assert "Платежи" in titles
    # H2 container §27 itself is NOT a leaf — only its H3s.
    assert titles.count("FAQ") == 0


def test_h1_path_uses_h2_parent_breadcrumb() -> None:
    sections = parse_sections(_MD)
    # The H3 leaf "Аутентификация" sits under §27 FAQ.
    auth = next(s for s in sections if s.title == "Аутентификация")
    assert auth.parent_number == "27"
    assert auth.parent_title == "FAQ"
    assert auth.h1_path.startswith("§27. FAQ >")
    assert "Аутентификация" in auth.h1_path


def test_classify_prose_table_and_faq() -> None:
    sections = parse_sections(_MD)
    by_title = {s.title: s for s in sections}
    assert classify_section(by_title["О продукте"]) == "prose"
    assert classify_section(by_title["Глоссарий"]) == "table"
    assert classify_section(by_title["Аутентификация"]) == "faq"
    assert classify_section(by_title["Пошагово"]) == "prose"


def test_chunk_product_md_emits_one_chunk_per_faq_pair() -> None:
    chunks = chunk_product_md(
        _MD, doc_id="test-dbp", source_uri="file:///tmp/PRODUCT.md"
    )
    faq_chunks = [c for c in chunks if c.metadata["doc_type"] == "faq"]
    # Three FAQ pairs in the fixture (2 under Аутентификация, 1 under Платежи).
    assert len(faq_chunks) == 3
    questions = {c.metadata.get("question") for c in faq_chunks}
    assert "Я забыл логин." in questions
    assert "Что такое КНП?" in questions


def test_chunk_product_md_emits_one_chunk_per_table_row() -> None:
    chunks = chunk_product_md(
        _MD, doc_id="test-dbp", source_uri="file:///tmp/PRODUCT.md"
    )
    table_chunks = [c for c in chunks if c.metadata["doc_type"] == "table"]
    assert len(table_chunks) == 2  # two glossary rows
    # Denormalized: "Термин: ИНН\nРасшифровка: ..."
    inn_chunk = next(c for c in table_chunks if "ИНН" in c.raw_text)
    assert "Термин: ИНН" in inn_chunk.raw_text
    assert "налогоплательщика" in inn_chunk.raw_text


def test_chunk_text_carries_breadcrumb_but_raw_text_stays_clean() -> None:
    chunks = chunk_product_md(
        _MD, doc_id="test-dbp", source_uri="file:///tmp/PRODUCT.md"
    )
    faq_chunk = next(
        c for c in chunks
        if c.metadata["doc_type"] == "faq" and "забыл логин" in c.raw_text
    )
    # text starts with [§27. FAQ > §Аутентификация ...] breadcrumb.
    assert faq_chunk.text.startswith("[§27. FAQ >")
    # raw_text (citation snippet) does NOT carry the prefix.
    assert not faq_chunk.raw_text.startswith("[§")
    assert faq_chunk.raw_text.startswith("**В:**")


def test_chunk_ids_are_deterministic_per_doc_id() -> None:
    """Re-running the chunker on the same input should produce identical ids
    so the Milvus MERGE behaves as an upsert, not an insert-with-duplicates."""
    a = chunk_product_md(_MD, doc_id="test-dbp", source_uri="x://")
    b = chunk_product_md(_MD, doc_id="test-dbp", source_uri="x://")
    assert [c.chunk_id for c in a] == [c.chunk_id for c in b]


def test_chunk_text_fits_milvus_varchar_limit() -> None:
    """Milvus VARCHAR caps at 8000 chars — the chunker must respect that."""
    long_para = "Это очень длинный параграф. " * 800
    md = textwrap.dedent(
        f"""\
        ## 1. Длинный раздел

        {long_para}
        """
    )
    chunks = chunk_product_md(md, doc_id="long", source_uri="x://")
    assert chunks, "expected at least one chunk for a long section"
    for c in chunks:
        assert len(c.text) <= 8000, f"chunk text exceeded Milvus VARCHAR limit: {len(c.text)}"


def test_empty_input_yields_no_chunks() -> None:
    assert chunk_product_md("", doc_id="x", source_uri="x://") == []
    assert chunk_product_md("# only a title\n", doc_id="x", source_uri="x://") == []


@pytest.mark.parametrize(
    "fragment",
    [
        "## 5. Раздел без тела\n\n",
        "## Содержание\n\nlink line\n\n",
    ],
)
def test_empty_or_toc_sections_are_skipped(fragment: str) -> None:
    """Containers with no body and the TOC must not emit chunks."""
    chunks = chunk_product_md(fragment, doc_id="x", source_uri="x://")
    assert chunks == []

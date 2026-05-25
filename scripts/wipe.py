#!/usr/bin/env python3
"""One-shot wipe for sovereign-rag.

Usage::

    uv run python scripts/wipe.py                  # corpus + threads (default)
    uv run python scripts/wipe.py --corpus         # docs + chunks + graph only
    uv run python scripts/wipe.py --threads        # conversations + pins only
    uv run python scripts/wipe.py --yes            # skip the confirm prompt

Reads the same env / .env that the API does (via sovereign_rag.config), so
whichever stack the backend is configured against — local docker-compose or
a remote staging cluster — is what we'll nuke. Use carefully.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import cast

from sovereign_rag.admin import WipeReport, wipe_all, wipe_corpus, wipe_threads
from sovereign_rag.config import get_settings


def _print_report(d: dict[str, object]) -> None:
    width = max(len(k) for k in d) + 2
    for k, v in d.items():
        print(f"  {k.ljust(width)} {v}")


async def _run(scope: str) -> None:
    s = get_settings()
    print("sovereign-rag wipe")
    print(f"  milvus  · {s.milvus_uri} · collection={s.milvus_collection}")
    print(f"  neo4j   · {s.neo4j_uri} · database={s.neo4j_database}")
    print(f"  pg      · {s.langgraph_pg_uri.split('@')[-1]}")
    print()
    if scope == "all":
        report = cast(dict[str, object], await wipe_all())
    elif scope == "corpus":
        report = await wipe_corpus()
    else:
        report = await wipe_threads()
    print("done.\n")
    _print_report(report)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--corpus", action="store_true", help="docs + chunks + graph only")
    g.add_argument("--threads", action="store_true", help="conversations + pins only")
    p.add_argument("-y", "--yes", action="store_true", help="skip the confirm prompt")
    args = p.parse_args()

    scope = "corpus" if args.corpus else "threads" if args.threads else "all"
    s = get_settings()

    if not args.yes:
        print(f"About to WIPE ({scope}). This is irreversible.")
        print(f"  milvus   · {s.milvus_uri} :: {s.milvus_collection}")
        print(f"  neo4j    · {s.neo4j_uri} :: {s.neo4j_database}")
        print(f"  postgres · {s.langgraph_pg_uri.split('@')[-1]}")
        if input("Type 'wipe' to confirm: ").strip().lower() != "wipe":
            print("aborted.")
            return 1

    asyncio.run(_run(scope))
    return 0


if __name__ == "__main__":
    sys.exit(main())


# Type narrowing for mypy without importing WipeReport at runtime.
_ = WipeReport

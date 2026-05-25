"""Run-history endpoints — audit log of every /ask invocation."""

from sovereign_rag.api.runs.router import router
from sovereign_rag.api.runs.service import ensure_runs_table, record_run

__all__ = ["ensure_runs_table", "record_run", "router"]

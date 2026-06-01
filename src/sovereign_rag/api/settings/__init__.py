"""Settings endpoints + persistence."""

from sovereign_rag.api.settings.router import router
from sovereign_rag.api.settings.service import (
    ensure_settings_table,
    load_and_apply_overrides,
)

__all__ = ["ensure_settings_table", "load_and_apply_overrides", "router"]

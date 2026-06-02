"""Ask endpoints — run the QA graph."""

import sovereign_rag.api.ask.router  # noqa: F401 — ensure the submodule is loaded and registered
from sovereign_rag.api.ask.router import _build_response
from sovereign_rag.api.ask.schemas import AskRequest, AskResponse, CitationModel

# ``router`` is intentionally not imported as a package-level name here — doing
# so would shadow the ``router`` submodule and break
# ``import sovereign_rag.api.ask.router as ask_router``.  Callers can still use
# ``from sovereign_rag.api.ask.router import router`` or the bare submodule import.
__all__ = [
    "AskRequest",
    "AskResponse",
    "CitationModel",
    "_build_response",
    "router",
]

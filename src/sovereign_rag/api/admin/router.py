"""``POST /admin/wipe`` — drop the corpus and/or threads.

Irreversible. Callers MUST confirm with the user before firing; the
``confirm`` field guards against accidental POSTs but the real safety net
belongs in the UI / CLI.
"""

from __future__ import annotations

from typing import Literal, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["admin"])


class WipeRequest(BaseModel):
    scope: Literal["all", "corpus", "threads"] = "all"
    confirm: str = Field(..., description="must equal 'wipe' for the request to take effect")


@router.post("/admin/wipe")
async def admin_wipe(req: WipeRequest) -> dict[str, object]:
    from sovereign_rag.admin import wipe_all, wipe_corpus, wipe_threads

    if req.confirm != "wipe":
        raise HTTPException(status_code=400, detail="confirm must be 'wipe'")
    if req.scope == "corpus":
        return await wipe_corpus()
    if req.scope == "threads":
        return await wipe_threads()
    return cast(dict[str, object], await wipe_all())


__all__ = ["router"]

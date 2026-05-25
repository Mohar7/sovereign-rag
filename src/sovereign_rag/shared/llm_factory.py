"""Tiered chat-model factory.

``get_chat_model(model_tier="default"|"light"|"nano", temperature, max_retries)``
is the single entry-point every graph node should use to obtain a chat LLM.

Provider selection is driven by ``Settings.llm_provider``:

- ``ollama`` — local Ollama daemon or Ollama Cloud (Bearer via ``ollama_api_key``).
  Uses ``langchain_ollama.ChatOllama``. Default for the local-first stack.
- ``openai`` — OpenAI / OpenAI-compatible API via ``langchain_openai.ChatOpenAI``.
  Picks the model from ``openai_chat_model[_light|_nano]`` settings, falling back
  to the matching ``llm_model[_light|_nano]`` if the OpenAI-specific one is blank.

Mirrors FB_ASSESSOR's ``shared/llm_factory.py`` API surface.

Tracing: callbacks are *not* baked into the returned model. Graphs attach the
Langfuse handler once at compile time via ``with_config({"callbacks": [...]})``,
which propagates to every LLM call.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Literal

from langchain_core.language_models import BaseChatModel

from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

ModelTier = Literal["default", "light", "nano"]


def _ollama_model_for_tier(tier: ModelTier) -> str:
    s = get_settings()
    return {
        "default": s.llm_model,
        "light": s.llm_model_light,
        "nano": s.llm_model_nano,
    }[tier]


def _openai_model_for_tier(tier: ModelTier) -> str:
    s = get_settings()
    explicit = {
        "default": s.openai_chat_model,
        "light": s.openai_chat_model_light,
        "nano": s.openai_chat_model_nano,
    }[tier]
    # Fall back to the shared llm_model* setting if the OpenAI-specific override
    # is blank — lets callers configure tiers once and switch providers freely.
    return explicit or _ollama_model_for_tier(tier)


def _build_ollama(tier: ModelTier, temperature: float, **kwargs: Any) -> BaseChatModel:
    from langchain_ollama import ChatOllama

    s = get_settings()
    client_kwargs: dict[str, Any] = (
        {"headers": {"Authorization": f"Bearer {s.ollama_api_key}"}} if s.ollama_api_key else {}
    )
    model = _ollama_model_for_tier(tier)
    logger.info("LLM [%s]: ollama/%s base=%s", tier, model, s.ollama_base_url)
    return ChatOllama(
        model=model,
        base_url=s.ollama_base_url,
        temperature=temperature,
        num_ctx=s.llm_num_ctx,
        client_kwargs=client_kwargs,
        **kwargs,
    )


def _is_reasoning_model(model: str) -> bool:
    """gpt-5 / o-series reasoning models reject custom ``temperature`` / ``top_p``.

    OpenAI's policy: only the default temperature (1) is accepted. RAGAS — and
    LangChain itself — frequently pass per-call temperature overrides, which
    these models 400 on. Detect them here so the factory can route around it.
    """
    m = model.lower()
    return m.startswith(("gpt-5", "o1", "o3", "o4"))


_reasoning_safe_cls: type | None = None


def _reasoning_safe_chat_openai_cls() -> type:
    """Lazily build a ChatOpenAI subclass that strips reasoning-incompatible kwargs.

    Defined inside a function so that the Ollama-only code path never has to
    import ``langchain_openai``. Cached after the first build.
    """
    global _reasoning_safe_cls
    if _reasoning_safe_cls is not None:
        return _reasoning_safe_cls
    from langchain_openai import ChatOpenAI

    class ReasoningSafeChatOpenAI(ChatOpenAI):  # type: ignore[misc, valid-type]
        """gpt-5/o-series-friendly ChatOpenAI.

        Removes ``temperature`` and ``top_p`` from every outbound request body
        because reasoning models reject any value other than the default. The
        instance attribute is left untouched (we don't try to set one); we just
        scrub the wire payload right before it leaves langchain.
        """

        def _get_request_payload(
            self,
            input_: Any,
            *,
            stop: list[str] | None = None,
            **kwargs: Any,
        ) -> dict[str, Any]:
            payload = super()._get_request_payload(input_, stop=stop, **kwargs)
            payload.pop("temperature", None)
            payload.pop("top_p", None)
            return payload

    _reasoning_safe_cls = ReasoningSafeChatOpenAI
    return _reasoning_safe_cls


def _build_openai(tier: ModelTier, temperature: float, **kwargs: Any) -> BaseChatModel:
    from langchain_openai import ChatOpenAI
    from pydantic import SecretStr

    s = get_settings()
    if not s.openai_api_key:
        raise RuntimeError(
            "llm_provider='openai' but OPENAI_API_KEY is not set. "
            "Set it in .env / direnv before invoking the graph."
        )
    model = _openai_model_for_tier(tier)
    reasoning = _is_reasoning_model(model)
    cls: type = _reasoning_safe_chat_openai_cls() if reasoning else ChatOpenAI
    logger.info("LLM [%s]: openai/%s (reasoning_safe=%s)", tier, model, reasoning)
    init_kwargs: dict[str, Any] = {
        "model": model,
        "api_key": SecretStr(s.openai_api_key),
        **kwargs,
    }
    # Reasoning models only accept the default temperature. Don't set one on
    # the instance; the subclass also strips per-call overrides.
    if not reasoning:
        init_kwargs["temperature"] = temperature
    return cls(**init_kwargs)


@lru_cache(maxsize=8)
def _cached(provider: str, tier: ModelTier, temperature: float) -> BaseChatModel:
    if provider == "openai":
        return _build_openai(tier, temperature)
    if provider == "ollama":
        return _build_ollama(tier, temperature)
    msg = f"Unknown llm_provider={provider!r}. Expected 'ollama' or 'openai'."
    raise RuntimeError(msg)


def get_chat_model(
    *,
    model_tier: ModelTier = "default",
    temperature: float | None = None,
    **kwargs: Any,
) -> BaseChatModel:
    """Return a chat model for the given tier, using ``Settings.llm_provider``.

    Args:
        model_tier: ``default`` (the answer LLM), ``light`` (cheap structured
            output), or ``nano`` (smallest, cheapest).
        temperature: Sampling temperature. ``None`` → ``settings.llm_temperature``.
        **kwargs: Forwarded to the underlying constructor. Pass sparingly — the
            cache only kicks in for the (provider, tier, temperature) tuple.
    """
    s = get_settings()
    temp = s.llm_temperature if temperature is None else temperature
    if not kwargs:
        return _cached(s.llm_provider, model_tier, temp)
    # Cache-busting path. Prefer building on top of the cached instance via
    # ``.with_structured_output()`` / ``.bind()`` etc. when possible.
    if s.llm_provider == "openai":
        return _build_openai(model_tier, temp, **kwargs)
    return _build_ollama(model_tier, temp, **kwargs)


__all__ = ["ModelTier", "get_chat_model"]

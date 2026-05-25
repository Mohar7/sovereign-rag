"""Langfuse tracing wired through OpenTelemetry.

The langfuse.langchain ``CallbackHandler`` drops spans on async LangGraph —
the OTEL context isn't preserved across ``async def`` node boundaries, so
node/retriever/tool spans either get reparented under the wrong trace or
disappear entirely (see langfuse#8780, #10721, #9236). We sidestep that by
going through OpenTelemetry directly:

- OTLP/HTTP exporter posts spans to Langfuse's ``/api/public/otel`` endpoint,
  authenticated with the same public/secret keys.
- ``openinference.instrumentation.langchain.LangChainInstrumentor`` patches
  LangChain so every node Runnable, LLM call, retriever, and tool emits a
  proper OTEL span — async-safe by construction.

``setup_tracing()`` is called once per graph factory. It is idempotent
(``lru_cache``) and a no-op when ``enable_langfuse`` is off or the credentials
are missing, so the local-first path still works without observability.
"""

from __future__ import annotations

import base64
import logging
import os
from functools import lru_cache

from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

# Map ENVIRONMENT to LANGFUSE_TRACING_ENVIRONMENT so Langfuse buckets traces
# correctly when LangChainInstrumentor sets `langfuse.environment` resource attr.
if "LANGFUSE_TRACING_ENVIRONMENT" not in os.environ:
    os.environ["LANGFUSE_TRACING_ENVIRONMENT"] = os.environ.get("ENVIRONMENT", "local")


@lru_cache(maxsize=1)
def setup_tracing() -> bool:
    """Configure OTEL exporter to Langfuse + instrument LangChain.

    Returns True when tracing is active, False when disabled or unavailable.
    Safe to call from each graph's ``make_graph()`` factory — the lru_cache
    guarantees the OTEL provider and instrumentor only get installed once.
    """
    s = get_settings()

    if not s.enable_langfuse:
        logger.info("tracing: enable_langfuse=false, OTEL setup skipped")
        return False
    if not (s.langfuse_public_key and s.langfuse_secret_key and s.langfuse_base_url):
        logger.warning("tracing: missing langfuse credentials/url — OTEL disabled")
        return False

    # Allow operator override via standard OTEL env vars. If neither is set,
    # compute both from the Langfuse settings.
    endpoint_env = "OTEL_EXPORTER_OTLP_ENDPOINT"
    headers_env = "OTEL_EXPORTER_OTLP_HEADERS"
    if endpoint_env not in os.environ:
        os.environ[endpoint_env] = f"{s.langfuse_base_url.rstrip('/')}/api/public/otel"
    if headers_env not in os.environ:
        auth = base64.b64encode(
            f"{s.langfuse_public_key}:{s.langfuse_secret_key}".encode()
        ).decode()
        os.environ[headers_env] = f"Authorization=Basic {auth}"

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError as exc:
        logger.warning("tracing: OTEL SDK unavailable (%s) — disabled", exc)
        return False

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": "sovereign-rag",
                "deployment.environment": os.environ["LANGFUSE_TRACING_ENVIRONMENT"],
            }
        ),
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    try:
        from openinference.instrumentation.langchain import LangChainInstrumentor
    except ImportError as exc:
        logger.warning(
            "tracing: openinference-instrumentation-langchain missing (%s) — "
            "OTEL exporter configured but LangChain auto-instrumentation OFF",
            exc,
        )
        return True

    LangChainInstrumentor().instrument()
    logger.info(
        "tracing: OTEL → Langfuse %s (LangChain instrumented)",
        s.langfuse_base_url,
    )
    return True


__all__ = ["setup_tracing"]

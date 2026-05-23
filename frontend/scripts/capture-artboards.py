"""Capture screenshots of the five Ask-screen artboards.

Walks the /artboards route, finds every `.frame` element (one per
state), and saves a 1440×900 PNG of each into ``docs/screenshots/``.

Usage:
    uv run python frontend/scripts/capture-artboards.py \\
        --url http://127.0.0.1:5173/artboards \\
        --out docs/screenshots/

The frontend must be running for this to do anything (``npm run dev``
or ``npm run preview`` in ``frontend/``). Playwright + chromium come
in via ``crawl4ai`` already in the project; if you haven't run
``uv run playwright install chromium`` once, do that first.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

LABELS = [
    "01-hero",
    "02-empty",
    "03-mid-stream",
    "04-hitl",
    "05-error",
]


async def capture(url: str, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1520, "height": 940},
            device_scale_factor=2,  # @2x — sharper screenshots for retina readme
        )
        page = await ctx.new_page()
        await page.goto(url, wait_until="networkidle")
        # Give the fonts a moment to swap in — IBM Plex loads from Google.
        await page.wait_for_timeout(800)

        frames = await page.query_selector_all(".artboards .frame")
        if not frames:
            print("no frames found — is the dev server up at", url, "?")
            return
        if len(frames) != len(LABELS):
            print(f"warning: found {len(frames)} frames, expected {len(LABELS)}")

        for i, frame in enumerate(frames):
            label = LABELS[i] if i < len(LABELS) else f"frame-{i:02d}"
            path = out_dir / f"{label}.png"
            await frame.scroll_into_view_if_needed()
            await page.wait_for_timeout(150)
            await frame.screenshot(path=str(path))
            print(f"  wrote {path}")

        await browser.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:5173/artboards")
    ap.add_argument("--out", default="docs/screenshots")
    args = ap.parse_args()
    asyncio.run(capture(args.url, Path(args.out)))


if __name__ == "__main__":
    main()

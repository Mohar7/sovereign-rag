// End-to-end browser tests for the Ask screen against the live LangGraph
// deployment.  Selectors use class hooks where text spans multiple nodes
// (e.g. "THREADS · 8" is three siblings), and rely on accessible roles
// elsewhere.

import { expect, test } from "@playwright/test";

test.describe("Ask screen · live", () => {
  test("loads with empty state + threads rail + composer", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/sovereign-rag/i);
    await expect(page.getByText("Ask anything across your corpus.")).toBeVisible();
    await expect(page.locator(".threads")).toBeVisible();
    await expect(page.locator(".composer textarea")).toBeVisible();
    await expect(page.locator(".send-btn")).toBeDisabled();
  });

  test("send → streaming answer with citation + sources", async ({ page }) => {
    await page.goto("/");

    // Wait for the composer to be ready, then submit via Enter — the
    // most reliable submit path (matches the design's keyboard hint).
    const composer = page.locator(".composer textarea");
    await composer.click();
    await composer.fill("What is the secret codeword for activation?");
    await composer.press("Enter");

    // The assistant turn streams the answer — wait for the codeword.
    await expect(page.getByText(/FERRET[-\s]?9X[-\s]?3000/)).toBeVisible({
      timeout: 60_000,
    });

    // At least one source card appears in the right rail.
    await expect(page.locator(".source-card").first()).toBeVisible();
  });

  test("⌘K opens the command palette", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".threads")).toBeVisible();
    await page.keyboard.press("Meta+k");
    await expect(page.locator(".palette")).toBeVisible();
    await expect(page.locator(".palette-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toBeHidden();
  });

  test("Settings button opens the panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText(/Retrieval parameters/)).toBeVisible();
    // 5 tabs in the drawer.
    await expect(page.locator(".tabs .tab")).toHaveCount(5);
    // The slider control renders inside the Retrieval tab content.
    await expect(page.locator(".drawer-right .slider").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".drawer-right")).toBeHidden();
  });

  test("/artboards renders the five mock states", async ({ page }) => {
    await page.goto("/artboards");
    // Each artboard is wrapped in an .ab block.
    await expect(page.locator(".ab")).toHaveCount(5);
    await expect(page.getByText("Hero · full conversation", { exact: false })).toBeVisible();
    await expect(page.getByText("HITL · approve URLs", { exact: false })).toBeVisible();
    await expect(page.getByText("Error · backend unreachable", { exact: false })).toBeVisible();
  });

  test("/components shows the atomic primitives sheet", async ({ page }) => {
    await page.goto("/components");
    await expect(page.locator(".compsheet")).toBeVisible();
    // 10 numbered blocks.
    await expect(page.locator(".cs-block")).toHaveCount(10);
    await expect(page.getByText("Citation · hover popover", { exact: false })).toBeVisible();
  });
});

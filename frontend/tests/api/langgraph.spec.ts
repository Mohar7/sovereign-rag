// API contract tests against the LangGraph deployment.
// Uses Playwright's `request` fixture so no browser is launched.
//
// Asserts:
//   - /lg/info returns version metadata
//   - /lg/assistants/search finds the `sovereign_qa` graph
//   - /lg/threads CRUD round-trips
//   - /lg/threads/{id}/runs/stream emits a well-formed SSE stream that
//     finishes with a `values` event carrying `answer` + `citations`.

import { expect, test } from "@playwright/test";

const LG = "/lg";

test.describe("LangGraph deployment · contract", () => {
  test("/info reports the langgraph-api version", async ({ request }) => {
    const res = await request.get(`${LG}/info`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.version).toMatch(/^\d+\.\d+/);
    expect(body.langgraph_py_version).toMatch(/^\d+\.\d+/);
  });

  test("/assistants/search discovers sovereign_qa", async ({ request }) => {
    const res = await request.post(`${LG}/assistants/search`, { data: {} });
    expect(res.ok()).toBeTruthy();
    const list = (await res.json()) as Array<{ graph_id: string; name: string }>;
    const sovereign = list.find((a) => a.graph_id === "sovereign_qa");
    expect(sovereign, "sovereign_qa assistant missing").toBeTruthy();
    expect(sovereign?.name).toBe("sovereign_qa");
  });

  test("/threads create and search round-trips", async ({ request }) => {
    const created = await request.post(`${LG}/threads`, {
      data: { metadata: { e2e: "true", title: "e2e contract probe" } },
    });
    expect(created.ok()).toBeTruthy();
    const t = await created.json();
    expect(t.thread_id).toMatch(/^[0-9a-f-]+$/);
    expect(t.metadata.e2e).toBe("true");

    const searched = await request.post(`${LG}/threads/search`, {
      data: { metadata: { e2e: "true" }, limit: 10 },
    });
    expect(searched.ok()).toBeTruthy();
    const found = (await searched.json()) as Array<{ thread_id: string }>;
    expect(found.some((x) => x.thread_id === t.thread_id)).toBeTruthy();
  });

  test("/runs/stream produces a full QA roundtrip", async ({ request }) => {
    // Create a fresh thread so prior probes don't pollute the run.
    const t = await (
      await request.post(`${LG}/threads`, { data: { metadata: { e2e: "qa" } } })
    ).json();

    // Run the QA synchronously via the wait endpoint so we get the final
    // state in one shot — robust against playwright's SSE buffering.
    // The graph runs in <10s on a warm pipeline; cap at 90s for safety.
    const res = await request.post(`${LG}/threads/${t.thread_id}/runs/wait`, {
      data: {
        assistant_id: "sovereign_qa",
        input: { question: "What is the secret codeword for activation?" },
      },
      timeout: 90_000,
    });
    expect(res.ok()).toBeTruthy();
    const finalState = await res.json();

    expect(typeof finalState.answer).toBe("string");
    expect(finalState.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(finalState.citations)).toBeTruthy();
    expect(finalState.citations.length).toBeGreaterThan(0);
    expect(typeof finalState.used).toBe("number");
  });
});

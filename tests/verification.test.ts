import { describe, expect, it, vi } from "vitest";

import {
  buildTraceUrl,
  buildTracesUrl,
  TRACE_POLL_INTERVAL_MS,
  TRACE_POLL_TIMEOUT_MS,
  verifyFirstTrace,
} from "../src/verification.js";

const since = new Date("2026-10-17T10:00:00.000Z");

const options = {
  apiUrl: "https://api.example/",
  appUrl: "https://app.example/",
  apiKey: "confident_us_key",
  projectId: "project-1",
  since,
};

const traceList = (traces: unknown[]): Response =>
  new Response(
    JSON.stringify({
      success: true,
      data: { traces, totalTraces: traces.length, nextCursor: null },
      deprecated: false,
    }),
    { status: 200 },
  );

const trace = {
  uuid: "trace/1",
  name: "answer",
  status: "SUCCESS",
  startTime: "2026-10-17T10:00:05.000Z",
  endTime: "2026-10-17T10:00:06.000Z",
  latency: 1.2,
  cost: null,
  threadId: null,
  userId: null,
  customerId: null,
  environment: "development",
  tags: null,
  metadata: null,
  inputPreview: "Hello",
  outputPreview: "Hi",
};

/** A fake clock that sleep advances, so polling runs instantly. */
const clock = () => {
  let current = 0;
  return {
    now: () => current,
    sleep: vi.fn(async (milliseconds: number) => {
      current += milliseconds;
    }),
  };
};

describe("first trace verification", () => {
  it("polls until a trace arrives, then links to it", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(traceList([]))
      .mockResolvedValueOnce(traceList([trace]));
    const time = clock();

    await expect(
      verifyFirstTrace(options, { fetch, ...time }),
    ).resolves.toEqual({
      status: "found",
      trace: { uuid: "trace/1", name: "answer" },
      traceUrl:
        "https://app.example/project/project-1/observatory/traces/trace%2F1",
      tracesUrl: "https://app.example/project/project-1/observatory/traces",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(time.sleep).toHaveBeenCalledWith(TRACE_POLL_INTERVAL_MS);

    const [url, init] = fetch.mock.calls[0]!;
    const request = new URL(String(url));
    expect(request.origin + request.pathname).toBe(
      "https://api.example/v2/traces",
    );
    expect(request.searchParams.get("start")).toBe(since.toISOString());
    expect(request.searchParams.get("pageSize")).toBe("1");
    expect(String(url)).not.toContain(options.apiKey);
    expect(init).toEqual({ headers: { CONFIDENT_API_KEY: options.apiKey } });
  });

  it("falls back to the app home when the project is unknown", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(traceList([{ ...trace, name: null }]));
    await expect(
      verifyFirstTrace(
        { ...options, projectId: undefined },
        { fetch, ...clock() },
      ),
    ).resolves.toEqual({
      status: "found",
      trace: { uuid: "trace/1" },
      tracesUrl: "https://app.example",
    });
  });

  it("stops at once when the key is rejected", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
      }),
    );
    const result = await verifyFirstTrace(options, { fetch, ...clock() });
    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") return;
    expect(result.message).toContain("rejected the API key");
    expect(result.message).toContain("Invalid API key");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("explains a license that does not include tracing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Feature not enabled for this license",
          feature: "observability",
        }),
        { status: 403 },
      ),
    );
    const result = await verifyFirstTrace(options, { fetch, ...clock() });
    expect(result).toMatchObject({
      status: "error",
      tracesUrl: "https://app.example/project/project-1/observatory/traces",
    });
    if (result.status !== "error") return;
    expect(result.message).toContain("403");
    expect(result.message).toContain("Feature not enabled for this license");
  });

  it("times out with no trace after three minutes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => traceList([]));
    const time = clock();
    const onPoll = vi.fn();
    await expect(
      verifyFirstTrace(options, { fetch, ...time, onPoll }),
    ).resolves.toEqual({
      status: "timeout",
      tracesUrl: "https://app.example/project/project-1/observatory/traces",
    });
    expect(time.now()).toBeLessThanOrEqual(TRACE_POLL_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledTimes(
      TRACE_POLL_TIMEOUT_MS / TRACE_POLL_INTERVAL_MS + 1,
    );
    expect(onPoll).toHaveBeenLastCalledWith(TRACE_POLL_TIMEOUT_MS);
  });

  it("keeps polling through transient failures", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(traceList([trace]));
    await expect(
      verifyFirstTrace(options, { fetch, ...clock() }),
    ).resolves.toMatchObject({ status: "found" });
  });

  it("reports a service it never heard back from as an error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(`fetch failed for ${options.apiKey}`));
    const result = await verifyFirstTrace(options, {
      fetch,
      ...clock(),
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({ status: "error" });
    if (result.status !== "error") return;
    expect(result.message).toContain("Could not reach Confident AI");
    expect(result.message).not.toContain(options.apiKey);
  });

  it("builds the observatory links", () => {
    expect(buildTracesUrl("https://app.example/", "p")).toBe(
      "https://app.example/project/p/observatory/traces",
    );
    expect(buildTraceUrl("https://app.example", "p", "t")).toBe(
      "https://app.example/project/p/observatory/traces/t",
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { ConfidentApi } from "../src/api.js";
import {
  parseIssues,
  uploadIssues,
  watchIssuesFile,
  type IssueUpload,
} from "../src/issues.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const issues = [
  { name: "Refund approved over policy limit", description: "a" },
  { name: "Order status given without a lookup", description: "b" },
  { name: "Ignored a cancellation request", description: "c" },
];

const classifierList = (names: string[]) =>
  jsonResponse({
    success: true,
    data: {
      classifiers: names.map((name, index) => ({ id: `c${index}`, name })),
      totalClassifiers: names.length,
    },
  });

const created = (id: string) => jsonResponse({ success: true, data: { id } });

const calls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: (init as RequestInit | undefined)?.method ?? "GET",
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
    headers: (init as RequestInit | undefined)?.headers as Record<
      string,
      string
    >,
  }));

describe("uploadIssues", () => {
  it("adds unfavorable recommended labels to the exact Issues classifier", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(classifierList(["issues", "Issue", "Issues"]))
      .mockImplementation(async () => created("label"));
    const api = new ConfidentApi("https://api.example", { fetch });

    await expect(uploadIssues(api, "key", issues)).resolves.toEqual({
      status: "uploaded",
      created: false,
      labels: 3,
    });

    const sent = calls(fetch);
    expect(sent[0]?.url).toBe(
      "https://api.example/v2/classifiers?dataModel=TRACE&page=1&pageSize=100",
    );
    expect(sent[0]?.headers.CONFIDENT_API_KEY).toBe("key");
    expect(sent.slice(1).map(({ url }) => url)).toEqual(
      Array(3).fill("https://api.example/v2/classifiers/c2/labels"),
    );
    expect(sent[1]?.body).toEqual({
      name: "Refund approved over policy limit",
      description: "a",
      status: "RECOMMENDED",
      enabled: true,
      polarity: "LOWER_IS_BETTER",
    });
  });

  it("creates Issues when only near-misses exist", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(classifierList(["issues", "Issue"]))
      .mockResolvedValueOnce(created("new"))
      .mockImplementation(async () => created("label"));
    const api = new ConfidentApi("https://api.example", { fetch });

    await expect(uploadIssues(api, "key", issues)).resolves.toEqual({
      status: "uploaded",
      created: true,
      labels: 3,
    });
    const sent = calls(fetch);
    expect(sent[1]).toMatchObject({
      url: "https://api.example/v2/classifiers",
      method: "POST",
      body: { name: "Issues", dataModel: "TRACE", preset: "ISSUES" },
    });
    expect(sent[2]?.url).toBe("https://api.example/v2/classifiers/new/labels");
  });

  it("stops at the first failure and never throws", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(classifierList(["Issues"]))
      .mockResolvedValueOnce(created("label"))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Label already exists" }, 409),
      )
      .mockImplementation(async () => created("label"));
    const api = new ConfidentApi("https://api.example", { fetch });

    await expect(uploadIssues(api, "key", issues)).resolves.toEqual({
      status: "failed",
      uploaded: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("fails quietly when Confident AI cannot be reached", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("offline"));
    const api = new ConfidentApi("https://api.example", { fetch });

    await expect(uploadIssues(api, "key", issues)).resolves.toEqual({
      status: "failed",
      uploaded: 0,
    });
  });
});

describe("parseIssues", () => {
  it("accepts a non-empty array of names and descriptions only", () => {
    expect(parseIssues(JSON.stringify(issues))).toEqual(issues);
    expect(parseIssues("[]")).toBeUndefined();
    expect(parseIssues('[{"name":"x"}]')).toBeUndefined();
    expect(parseIssues('[{"name":"x","descr')).toBeUndefined();
  });
});

describe("watchIssuesFile", () => {
  it("uploads once, as soon as the file parses", async () => {
    vi.useFakeTimers();
    const reads = [
      Promise.reject(new Error("ENOENT")),
      Promise.resolve('[{"name":"x","descr'),
      Promise.resolve(JSON.stringify(issues)),
    ];
    reads[0]?.catch(() => undefined);
    const readFile = vi.fn(
      () => reads.shift() ?? Promise.resolve(JSON.stringify(issues)),
    );
    const result: IssueUpload = {
      status: "uploaded",
      created: false,
      labels: 3,
    };
    const upload = vi.fn().mockResolvedValue(result);

    const watcher = watchIssuesFile({
      path: "/tmp/issues.json",
      upload,
      intervalMs: 10,
      readFile,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(issues);
    expect(readFile).toHaveBeenCalledTimes(3);
    await expect(watcher.stop()).resolves.toEqual(result);
    vi.useRealTimers();
  });

  it("uploads nothing when stopped before the file appears", async () => {
    vi.useFakeTimers();
    const upload = vi.fn();
    const watcher = watchIssuesFile({
      path: "/tmp/issues.json",
      upload,
      intervalMs: 10,
      readFile: () => Promise.reject(new Error("ENOENT")),
    });
    await vi.advanceTimersByTimeAsync(30);
    await expect(watcher.stop()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(30);
    expect(upload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

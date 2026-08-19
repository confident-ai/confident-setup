import { describe, expect, it } from "vitest";

import { parseSetupResult } from "../src/result.js";

const validResult = {
  status: "completed",
  changedFiles: ["evals/evaluate.py"],
  sdks: ["deepeval-python"],
  levels: ["test-case", "span"],
  datasetSource: "Existing support examples",
  metrics: ["Answer relevancy", "Tool correctness"],
  rerunCommand: "python evals/evaluate.py",
  testRunId: "run-123",
};

describe("setup result validation", () => {
  it("accepts a complete structured result", () => {
    expect(parseSetupResult(validResult)).toEqual(validResult);
  });

  it("requires a run ID for completed cloud setup", () => {
    expect(() =>
      parseSetupResult({ ...validResult, testRunId: undefined }),
    ).toThrow("completed setup");
  });

  it("allows a completed local setup without a run ID", () => {
    expect(
      parseSetupResult(
        {
          status: "completed",
          changedFiles: validResult.changedFiles,
          sdks: validResult.sdks,
          levels: validResult.levels,
          datasetSource: validResult.datasetSource,
          metrics: validResult.metrics,
          rerunCommand: validResult.rerunCommand,
        },
        false,
      ),
    ).toMatchObject({
      status: "completed",
    });
  });

  it("requires errors for failures and rejects unknown fields", () => {
    expect(() =>
      parseSetupResult({
        ...validResult,
        status: "failed",
        testRunId: undefined,
      }),
    ).toThrow("failed setup");
    expect(() =>
      parseSetupResult({ ...validResult, apiKey: "secret" }),
    ).toThrow();
  });
});

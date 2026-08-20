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
    expect(parseSetupResult(validResult)).toEqual({
      ...validResult,
      shape: "component-level",
    });
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

  it("rejects a suite that evaluated no component", () => {
    expect(() =>
      parseSetupResult({ ...validResult, levels: ["test-case", "trace"] }),
    ).toThrow("component-level");
  });

  it("accepts a black-box run that had no spans to score", () => {
    expect(
      parseSetupResult({
        ...validResult,
        shape: "black-box",
        levels: ["test-case"],
        rerunCommand: ".venv/bin/python evals/evaluate_app.py",
      }),
    ).toMatchObject({ shape: "black-box" });
  });

  it("rejects a black-box run that claims spans", () => {
    expect(() =>
      parseSetupResult({ ...validResult, shape: "black-box" }),
    ).toThrow("cannot report the span level");
  });

  it("defaults to the component-level shape", () => {
    expect(parseSetupResult(validResult).shape).toBe("component-level");
  });

  it("lets a failure report the levels it never reached", () => {
    expect(
      parseSetupResult({
        ...validResult,
        status: "failed",
        levels: ["test-case"],
        testRunId: undefined,
        errors: ["No component could be observed."],
      }),
    ).toMatchObject({ status: "failed" });
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

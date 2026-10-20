import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSetupResult, readSetupResult } from "../src/result.js";

const validResult = {
  status: "completed",
  changedFiles: ["app/main.py", "pyproject.toml"],
  sdks: ["confident-trace-python"],
  integrations: ["OpenAI"],
  runCommand: "uv run --env-file .env.local python app/main.py",
  runSucceeded: true,
};

describe("setup result validation", () => {
  it("accepts a complete structured result", () => {
    expect(parseSetupResult(validResult)).toEqual(validResult);
  });

  it("accepts how many inputs were traced, as a whole number", () => {
    expect(parseSetupResult({ ...validResult, tracedRuns: 8 })).toMatchObject({
      tracedRuns: 8,
    });
    expect(() =>
      parseSetupResult({ ...validResult, tracedRuns: 1.5 }),
    ).toThrow();
    expect(() =>
      parseSetupResult({ ...validResult, tracedRuns: -1 }),
    ).toThrow();
  });

  it("requires a completed setup to have run the app", () => {
    expect(() =>
      parseSetupResult({ ...validResult, runSucceeded: false }),
    ).toThrow("must have run the app");
  });

  it("requires a partial setup to say what the user must provide", () => {
    const partial = { ...validResult, status: "partial", runSucceeded: false };
    expect(() => parseSetupResult(partial)).toThrow("needsFromUser");
    expect(() => parseSetupResult({ ...partial, needsFromUser: [] })).toThrow(
      "must say what the user needs",
    );
    expect(
      parseSetupResult({ ...partial, needsFromUser: ["Set OPENAI_API_KEY"] }),
    ).toMatchObject({ status: "partial" });
  });

  it("rejects a partial setup that claims the app ran", () => {
    expect(() =>
      parseSetupResult({
        ...validResult,
        status: "partial",
        needsFromUser: ["Start the database"],
      }),
    ).toThrow("did not run the app");
  });

  it("requires an SDK and a run command unless setup failed", () => {
    expect(() => parseSetupResult({ ...validResult, sdks: [] })).toThrow(
      "at least one SDK",
    );
    expect(() => parseSetupResult({ ...validResult, runCommand: " " })).toThrow(
      "command that runs the app",
    );
  });

  it("accepts every SDK the prompt names, and only those", () => {
    expect(
      parseSetupResult({
        ...validResult,
        sdks: ["confident-trace-typescript", "opentelemetry"],
      }).sdks,
    ).toHaveLength(2);
    expect(() =>
      parseSetupResult({ ...validResult, sdks: ["some-other-sdk"] }),
    ).toThrow();
  });

  it("lets a failure leave the SDK list and run command empty", () => {
    expect(
      parseSetupResult({
        ...validResult,
        status: "failed",
        sdks: [],
        runCommand: "",
        runSucceeded: false,
        errors: ["The project needs Python 3.10 or newer; found 3.8."],
      }),
    ).toMatchObject({ status: "failed" });
  });

  it("requires errors for failures and rejects unknown fields", () => {
    expect(() =>
      parseSetupResult({
        ...validResult,
        status: "failed",
        runSucceeded: false,
      }),
    ).toThrow("failed setup");
    expect(() =>
      parseSetupResult({ ...validResult, apiKey: "secret" }),
    ).toThrow();
  });
});

const writeResultFile = async (value: unknown): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "confident-result-"));
  const path = join(directory, "result.json");
  await writeFile(
    path,
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  );
  return path;
};

describe("reading a setup result file", () => {
  it("reads a result that meets the contract", async () => {
    const outcome = await readSetupResult(await writeResultFile(validResult));
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: "completed" },
    });
  });

  /**
   * The agent has already changed the project by now, so a rejected file must
   * still surrender the command that runs the app and the files it touched.
   */
  it("keeps the run command and changed files from a rejected result", async () => {
    const outcome = await readSetupResult(
      await writeResultFile({ ...validResult, runSucceeded: false }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.issues.join("\n")).toContain(
      "must have run the app",
    );
    expect(outcome.rejected.salvaged).toEqual({
      runCommand: validResult.runCommand,
      changedFiles: validResult.changedFiles,
    });
  });

  it("salvages nothing beyond those two fields", async () => {
    const outcome = await readSetupResult(
      await writeResultFile({ ...validResult, apiKey: "confident_us_secret" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.issues.join("\n")).toContain("apiKey");
    expect(outcome.rejected.salvaged).toEqual({
      runCommand: validResult.runCommand,
      changedFiles: validResult.changedFiles,
    });
  });

  it("salvages each field on its own", async () => {
    const outcome = await readSetupResult(
      await writeResultFile({ runCommand: "node app.js", changedFiles: "x" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.salvaged).toEqual({ runCommand: "node app.js" });
  });

  it("reports unreadable JSON without salvaging anything", async () => {
    const outcome = await readSetupResult(await writeResultFile("{not json"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejected.issues).toHaveLength(1);
    expect(outcome.rejected.salvaged).toEqual({});
  });
});

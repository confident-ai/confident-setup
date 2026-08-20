import { describe, expect, it, vi } from "vitest";

import {
  describeCommands,
  inspectDeepEval,
  installDeepEval,
  pythonEnvironments,
  type EnvironmentProbe,
} from "../src/deepeval.js";
import type { CommandRunner } from "../src/git.js";

const probe = (
  overrides: Partial<EnvironmentProbe> & { files?: Record<string, string> },
): EnvironmentProbe => {
  const files = overrides.files ?? {};
  return {
    exists: overrides.exists ?? (async (path) => path in files),
    readText: overrides.readText ?? (async (path) => files[path]),
    onPath: overrides.onPath ?? (async () => true),
    env: overrides.env ?? {},
  };
};

const ok: CommandRunner = async () => ({ stdout: "", stderr: "" });
const fails: CommandRunner = async () => {
  throw new Error("Command failed with exit code 1.");
};

describe("python environment detection", () => {
  it("prefers an active virtual environment over the project's own", async () => {
    const environments = await pythonEnvironments(
      "/app",
      probe({
        env: { VIRTUAL_ENV: "/tmp/venv" },
        files: {
          "/tmp/venv/bin/python": "",
          "/app/.venv/bin/python": "",
        },
      }),
    );
    expect(environments.map((environment) => environment.kind)).toEqual([
      "active-venv",
      "project-venv",
      "path-python",
    ]);
    expect(environments[0]?.install[0]?.command).toBe("/tmp/venv/bin/python");
  });

  it("uses each project manager's own install command", async () => {
    const poetry = await pythonEnvironments(
      "/app",
      probe({
        files: { "/app/pyproject.toml": "[tool.poetry]\nname = 'app'" },
      }),
    );
    expect(poetry[0]?.install).toEqual([
      { command: "poetry", args: ["add", "--group", "dev", "deepeval"] },
    ]);

    const uv = await pythonEnvironments(
      "/app",
      probe({ files: { "/app/uv.lock": "" } }),
    );
    expect(uv[0]?.install).toEqual([
      { command: "uv", args: ["add", "--dev", "deepeval"] },
    ]);
  });

  it("ignores a project manager that is not installed", async () => {
    const environments = await pythonEnvironments(
      "/app",
      probe({
        files: { "/app/pyproject.toml": "[tool.poetry]" },
        onPath: async () => false,
      }),
    );
    expect(environments.map((environment) => environment.kind)).toEqual([
      "path-python",
    ]);
  });
});

describe("deepeval preflight", () => {
  it("reports the environment that already has DeepEval", async () => {
    const status = await inspectDeepEval("/app", {
      probe: probe({ files: { "/app/.venv/bin/python": "" } }),
      runner: ok,
    });
    expect(status.installed?.kind).toBe("project-venv");
  });

  it("keeps looking past an environment that cannot import it", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockRejectedValueOnce(new Error("no deepeval"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const status = await inspectDeepEval("/app", {
      probe: probe({ files: { "/app/.venv/bin/python": "" } }),
      runner,
    });
    expect(status.installed?.kind).toBe("path-python");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("never targets the system interpreter for a new install", async () => {
    const status = await inspectDeepEval("/app", {
      probe: probe({}),
      runner: fails,
    });
    expect(status.installed).toBeUndefined();
    expect(status.target.kind).toBe("new-venv");
    expect(describeCommands(status.target.install)).toBe(
      [
        "  python3 -m venv .venv",
        "  .venv/bin/python -m pip install deepeval",
      ].join("\n"),
    );
  });

  it("installs into an existing environment in command order", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValue({ stdout: "", stderr: "" });
    const status = await inspectDeepEval("/app", {
      probe: probe({ files: { "/app/.venv/bin/python": "" } }),
      runner: fails,
    });
    await installDeepEval(status.target, "/app", runner);
    expect(status.target.kind).toBe("project-venv");
    expect(runner).toHaveBeenCalledWith(
      ".venv/bin/python",
      ["-m", "pip", "install", "deepeval"],
      { cwd: "/app" },
    );
  });
});

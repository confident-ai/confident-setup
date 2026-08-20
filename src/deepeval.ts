import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { runCommand, type CommandRunner } from "./git.js";

export const DEEPEVAL_PACKAGE = "deepeval";

/** Cheaper than importing DeepEval, which pulls in its whole metric tree. */
const IMPORT_CHECK =
  "import importlib.util as u, sys; sys.exit(0 if u.find_spec('deepeval') else 1)";

export interface Command {
  command: string;
  args: string[];
}

export type PythonEnvironmentKind =
  "active-venv" | "poetry" | "uv" | "project-venv" | "path-python" | "new-venv";

export interface PythonEnvironment {
  kind: PythonEnvironmentKind;
  /** Names where DeepEval lives or would land, for the confirmation prompt. */
  label: string;
  /** Exits zero when DeepEval is importable here. */
  check: Command;
  /** Run in order; the last one installs DeepEval. */
  install: Command[];
}

export interface EnvironmentProbe {
  exists: (path: string) => Promise<boolean>;
  readText: (path: string) => Promise<string | undefined>;
  onPath: (command: string) => Promise<boolean>;
  env: NodeJS.ProcessEnv;
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const readTextFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
};

/** `command -v` is a shell builtin that most Linux images do not ship as a
 * binary, so PATH is walked directly instead. */
const onPath = async (command: string): Promise<boolean> => {
  if (command.includes("/")) return pathExists(command);
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, command);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }
  return false;
};

export const defaultProbe: EnvironmentProbe = {
  exists: pathExists,
  readText: readTextFile,
  onPath,
  env: process.env,
};

const pythonImportCheck = (python: string): Command => ({
  command: python,
  args: ["-c", IMPORT_CHECK],
});

const pipInstall = (python: string): Command => ({
  command: python,
  args: ["-m", "pip", "install", DEEPEVAL_PACKAGE],
});

/** Relative so the confirmation prompt shows a command worth reading. */
const PROJECT_VENV_PYTHON = join(".venv", "bin", "python");

/**
 * Ordered by how likely each environment is the one the evaluation will run
 * in, so the first that already has DeepEval wins and the first that could
 * hold it becomes the install target.
 */
export const pythonEnvironments = async (
  projectDirectory: string,
  probe: EnvironmentProbe = defaultProbe,
): Promise<PythonEnvironment[]> => {
  const environments: PythonEnvironment[] = [];

  const activeVenv = probe.env.VIRTUAL_ENV?.trim();
  if (activeVenv) {
    const python = join(activeVenv, "bin", "python");
    if (await probe.exists(python)) {
      environments.push({
        kind: "active-venv",
        label: "the active virtual environment",
        check: pythonImportCheck(python),
        install: [pipInstall(python)],
      });
    }
  }

  const manifest = await probe.readText(
    join(projectDirectory, "pyproject.toml"),
  );
  if (manifest?.includes("[tool.poetry") && (await probe.onPath("poetry"))) {
    environments.push({
      kind: "poetry",
      label: "this project's Poetry environment",
      check: {
        command: "poetry",
        args: ["run", "python", "-c", IMPORT_CHECK],
      },
      install: [
        {
          command: "poetry",
          args: ["add", "--group", "dev", DEEPEVAL_PACKAGE],
        },
      ],
    });
  }
  const usesUv =
    manifest?.includes("[tool.uv") ||
    (await probe.exists(join(projectDirectory, "uv.lock")));
  if (usesUv && (await probe.onPath("uv"))) {
    environments.push({
      kind: "uv",
      label: "this project's uv environment",
      check: { command: "uv", args: ["run", "python", "-c", IMPORT_CHECK] },
      install: [{ command: "uv", args: ["add", "--dev", DEEPEVAL_PACKAGE] }],
    });
  }

  if (await probe.exists(join(projectDirectory, PROJECT_VENV_PYTHON))) {
    environments.push({
      kind: "project-venv",
      label: "the project's .venv",
      check: pythonImportCheck(PROJECT_VENV_PYTHON),
      install: [pipInstall(PROJECT_VENV_PYTHON)],
    });
  }

  environments.push({
    kind: "path-python",
    label: "the python3 on your PATH",
    check: pythonImportCheck("python3"),
    install: [pipInstall("python3")],
  });

  return environments;
};

/**
 * A bare `python3` may already carry DeepEval, which is worth honoring, but it
 * is never a good place to install one: a system interpreter is often managed
 * externally and rejects pip outright.
 */
export const newVenvEnvironment = (): PythonEnvironment => ({
  kind: "new-venv",
  label: "a new .venv in this project",
  check: pythonImportCheck(PROJECT_VENV_PYTHON),
  install: [
    { command: "python3", args: ["-m", "venv", ".venv"] },
    pipInstall(PROJECT_VENV_PYTHON),
  ],
});

export interface DeepEvalStatus {
  /** Set when some environment can already import DeepEval. */
  installed?: PythonEnvironment;
  /** Where an install would go when nothing has it yet. */
  target: PythonEnvironment;
}

export const describeCommands = (commands: Command[]): string =>
  commands
    .map(({ command, args }) => `  ${[command, ...args].join(" ")}`)
    .join("\n");

export interface DeepEvalDependencies {
  probe?: EnvironmentProbe;
  runner?: CommandRunner;
}

export const inspectDeepEval = async (
  projectDirectory: string,
  { probe = defaultProbe, runner = runCommand }: DeepEvalDependencies = {},
): Promise<DeepEvalStatus> => {
  const environments = await pythonEnvironments(projectDirectory, probe);
  for (const environment of environments) {
    try {
      await runner(environment.check.command, environment.check.args, {
        cwd: projectDirectory,
      });
      return { installed: environment, target: environment };
    } catch {
      // Keep looking: a missing interpreter reads the same as a missing import.
    }
  }
  const installable = environments.find(
    (environment) => environment.kind !== "path-python",
  );
  return { target: installable ?? newVenvEnvironment() };
};

export const installDeepEval = async (
  environment: PythonEnvironment,
  projectDirectory: string,
  runner: CommandRunner = runCommand,
): Promise<void> => {
  for (const { command, args } of environment.install) {
    await runner(command, args, { cwd: projectDirectory });
  }
};

import { spawn } from "node:child_process";
import { access, constants, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentKind = "claude" | "codex" | "cursor";
export type AgentPermission = "read-only" | "full";

export interface AgentDefinition {
  kind: AgentKind;
  label: string;
  command: string;
}

export interface AgentInvocation {
  command: string;
  args: string[];
}

/** Where an executable was found, so a failed check can say what to do. */
export type AgentSource =
  "path" | "install-dir" | "desktop-app" | "editor-extension";

export interface AgentCandidate {
  command: string;
  source: AgentSource;
}

export interface AgentCheck {
  /** With `command` resolved to the executable that answered. */
  agent: AgentDefinition;
  source?: AgentSource;
  discovered: boolean;
  authenticated: boolean;
  readOnlyReady: boolean;
  detail?: string;
}

export type AgentRunner = (
  invocation: AgentInvocation,
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
    timeoutMs?: number;
    onStdoutLine?: (line: string) => void;
  },
) => Promise<{ stdout: string }>;

export const supportedAgents: AgentDefinition[] = [
  { kind: "claude", label: "Claude Code", command: "claude" },
  { kind: "codex", label: "Codex", command: "codex" },
  { kind: "cursor", label: "Cursor CLI", command: "cursor-agent" },
];

export const buildAgentInvocation = (
  agent: AgentDefinition,
  permission: AgentPermission,
  prompt: string,
): AgentInvocation => {
  if (agent.kind === "claude") {
    return {
      command: agent.command,
      args:
        permission === "read-only"
          ? [
              "-p",
              prompt,
              "--permission-mode",
              "plan",
              "--no-session-persistence",
              "--tools",
              "",
              "--output-format",
              "json",
            ]
          : [
              "-p",
              prompt,
              "--no-session-persistence",
              "--permission-mode",
              "bypassPermissions",
              "--dangerously-skip-permissions",
              "--output-format",
              "stream-json",
              "--verbose",
            ],
    };
  }
  if (agent.kind === "cursor") {
    // The prompt is positional for this CLI, so it stays last.
    return {
      command: agent.command,
      args:
        permission === "read-only"
          ? [
              "--print",
              "--output-format",
              "json",
              "--mode",
              "ask",
              "--sandbox",
              "enabled",
              prompt,
            ]
          : [
              "--print",
              "--output-format",
              "stream-json",
              "--force",
              "--trust",
              "--sandbox",
              "disabled",
              prompt,
            ],
    };
  }
  return {
    command: agent.command,
    args: [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      permission === "read-only" ? "read-only" : "danger-full-access",
      ...(permission === "full"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : []),
      "--skip-git-repo-check",
      prompt,
    ],
  };
};

const authArguments: Record<AgentKind, string[]> = {
  claude: ["auth", "status"],
  codex: ["login", "status"],
  cursor: ["status", "--format", "json"],
};

const loginArguments: Record<AgentKind, string[]> = {
  claude: ["auth", "login"],
  codex: ["login"],
  cursor: ["login"],
};

const shellQuote = (value: string): string =>
  /^[\w./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/** The command a user runs once so we can launch the agent for them. */
export const signInCommand = (agent: AgentDefinition): string =>
  [agent.command, ...loginArguments[agent.kind]].map(shellQuote).join(" ");

/** One line per agent for the "no agent to launch" note. */
export const describeAgentCheck = (check: AgentCheck): string => {
  const { agent } = check;
  if (!check.discovered) return `${agent.label}: not found`;
  const where =
    check.source === "desktop-app"
      ? " (in the Claude desktop app)"
      : check.source === "editor-extension"
        ? " (from the Codex editor extension)"
        : check.source === "install-dir"
          ? ` (at ${agent.command})`
          : "";
  if (check.readOnlyReady) return `${agent.label}${where}: ready`;
  if (!check.authenticated) {
    return `${agent.label}${where}: installed, not signed in for terminal use.\n  Sign in once with: ${signInCommand(agent)}`;
  }
  return `${agent.label}${where}: installed, but its read-only check failed.${
    check.detail ? `\n  ${check.detail}` : ""
  }`;
};

export const getAuthInvocation = (agent: AgentDefinition): AgentInvocation => ({
  command: agent.command,
  args: authArguments[agent.kind],
});

const isExecutable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const versionOf = (name: string): number[] =>
  (/\d+(?:\.\d+)+/.exec(name)?.[0] ?? "0").split(".").map(Number);

const compareVersionsDescending = (left: string, right: string): number => {
  const [a, b] = [versionOf(left), versionOf(right)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

/** A literal path segment, or any directory whose name matches. */
type Segment = string | RegExp;

/**
 * Executables under `root` along `segments`, newest version first wherever a
 * pattern matches several directories, so the most recent build wins.
 */
const findExecutables = async (
  root: string,
  segments: Segment[],
): Promise<string[]> => {
  const [segment, ...rest] = segments;
  if (segment === undefined) return (await isExecutable(root)) ? [root] : [];
  if (typeof segment === "string") {
    return findExecutables(join(root, segment), rest);
  }
  const entries = await readdir(root).catch(() => [] as string[]);
  const found: string[] = [];
  for (const entry of entries
    .filter((name) => segment.test(name))
    .sort(compareVersionsDescending)) {
    found.push(...(await findExecutables(join(root, entry), rest)));
  }
  return found;
};

interface Location {
  root: string | undefined;
  segments: Segment[];
  source: AgentSource;
}

const ANY = /./;
/** The Codex extension for VS Code and its forks ships the CLI it runs. */
const CODEX_EXTENSION = /^openai\.chatgpt-/;

/**
 * Where each agent lands when it is not on PATH: its own installer's
 * directory, or a copy bundled with a desktop app or editor extension.
 * A wrong guess costs nothing, since a location is only used when it exists
 * and answers `--version`.
 */
const agentLocations = (
  kind: AgentKind,
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Location[] => {
  const editorDirs = [".vscode", ".vscode-insiders", ".cursor", ".windsurf"];
  if (platform === "win32") {
    const exe = {
      claude: "claude.exe",
      codex: "codex.exe",
      cursor: "cursor-agent.exe",
    }[kind];
    if (kind === "claude") {
      return [
        { root: home, segments: [".local", "bin", exe], source: "install-dir" },
        // Seen in the desktop app's logs as claude-code\<version>\claude.exe.
        {
          root: env.APPDATA,
          segments: ["Claude", "claude-code", ANY, exe],
          source: "desktop-app",
        },
      ];
    }
    if (kind === "cursor") {
      return [
        {
          root: env.LOCALAPPDATA,
          segments: ["cursor-agent", exe],
          source: "install-dir",
        },
      ];
    }
    return editorDirs.map((dir) => ({
      root: home,
      segments: [dir, "extensions", CODEX_EXTENSION, "bin", ANY, exe],
      source: "editor-extension",
    }));
  }

  const command = { claude: "claude", codex: "codex", cursor: "cursor-agent" }[
    kind
  ];
  const locations: Location[] = [
    { root: home, segments: [".local", "bin", command], source: "install-dir" },
  ];
  if (kind === "claude") {
    locations.push({
      root: home,
      segments: [".claude", "local", "claude"],
      source: "install-dir",
    });
    if (platform === "darwin") {
      locations.push({
        root: home,
        segments: [
          "Library",
          "Application Support",
          "Claude",
          "claude-code",
          ANY,
          ANY,
          "claude.app",
          "Contents",
          "MacOS",
          "claude",
        ],
        source: "desktop-app",
      });
    }
  }
  if (kind === "codex") {
    for (const dir of editorDirs) {
      locations.push({
        root: home,
        segments: [dir, "extensions", CODEX_EXTENSION, "bin", ANY, "codex"],
        source: "editor-extension",
      });
    }
  }
  return locations;
};

/**
 * PATH first, then the places a terminal launched from a GUI or a fresh shell
 * may not have on PATH.
 */
export const findAgentCandidates = async (
  agent: AgentDefinition,
  {
    home = homedir(),
    platform = process.platform,
    env = process.env,
  }: {
    home?: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<AgentCandidate[]> => {
  const candidates: AgentCandidate[] = [
    { command: agent.command, source: "path" },
  ];
  for (const { root, segments, source } of agentLocations(
    agent.kind,
    home,
    platform,
    env,
  )) {
    if (!root) continue;
    for (const command of await findExecutables(root, segments)) {
      candidates.push({ command, source });
    }
  }
  return candidates;
};

export const runAgent: AgentRunner = (
  invocation,
  { cwd, env, stdio = "pipe", timeoutMs = 30_000, onStdoutLine },
) =>
  new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        stdoutLineBuffer += text;
        let newline = stdoutLineBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutLineBuffer.slice(0, newline).trim();
          stdoutLineBuffer = stdoutLineBuffer.slice(newline + 1);
          if (line) onStdoutLine?.(line);
          newline = stdoutLineBuffer.indexOf("\n");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `${invocation.command} timed out after ${Math.round(timeoutMs / 1000)}s.`,
        ),
      );
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const finalLine = stdoutLineBuffer.trim();
      if (finalLine) onStdoutLine?.(finalLine);
      if (code === 0) {
        resolve({ stdout });
      } else {
        const detail = stderr
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        reject(
          new Error(
            `${invocation.command} exited with ${signal ?? code}${
              detail ? `: ${detail.slice(0, 300)}` : ""
            }`,
          ),
        );
      }
    });
  });

export const checkAgent = async (
  definition: AgentDefinition,
  cwd: string,
  runner: AgentRunner = runAgent,
  candidates?: AgentCandidate[],
): Promise<AgentCheck> => {
  let found: AgentCandidate | undefined;
  for (const candidate of candidates ??
    (await findAgentCandidates(definition))) {
    try {
      await runner(
        { command: candidate.command, args: ["--version"] },
        { cwd, timeoutMs: 10_000 },
      );
      found = candidate;
      break;
    } catch {
      // Try the next location.
    }
  }
  if (!found) {
    return {
      agent: definition,
      discovered: false,
      authenticated: false,
      readOnlyReady: false,
      detail: "Executable not found.",
    };
  }
  const agent = { ...definition, command: found.command };
  const source = found.source;

  try {
    await runner(getAuthInvocation(agent), { cwd, timeoutMs: 15_000 });
  } catch (error) {
    return {
      agent,
      source,
      discovered: true,
      authenticated: false,
      readOnlyReady: false,
      detail: error instanceof Error ? error.message : "Authentication failed.",
    };
  }

  try {
    await runner(
      buildAgentInvocation(
        agent,
        "read-only",
        "Read-only smoke check: do not inspect files or environment. Reply READY.",
      ),
      { cwd, timeoutMs: 60_000 },
    );
    return {
      agent,
      source,
      discovered: true,
      authenticated: true,
      readOnlyReady: true,
    };
  } catch (error) {
    return {
      agent,
      source,
      discovered: true,
      authenticated: true,
      readOnlyReady: false,
      detail: error instanceof Error ? error.message : "Smoke check failed.",
    };
  }
};

export const executeAgent = async (
  agent: AgentDefinition,
  cwd: string,
  prompt: string,
  apiKey: string | undefined,
  resultFile: string,
  issuesFile: string,
  runner: AgentRunner = runAgent,
  onProgressLine?: (line: string) => void,
): Promise<void> => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CONFIDENT_SETUP_RESULT_FILE: resultFile,
    CONFIDENT_SETUP_ISSUES_FILE: issuesFile,
  };
  if (apiKey) env.CONFIDENT_API_KEY = apiKey;
  else delete env.CONFIDENT_API_KEY;
  await runner(buildAgentInvocation(agent, "full", prompt), {
    cwd,
    env,
    stdio: "pipe",
    timeoutMs: 30 * 60_000,
    ...(onProgressLine ? { onStdoutLine: onProgressLine } : {}),
  });
};

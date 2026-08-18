import { spawn } from "node:child_process";

export type AgentKind = "claude" | "codex";
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

export interface AgentCheck {
  agent: AgentDefinition;
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
  },
) => Promise<{ stdout: string }>;

export const supportedAgents: AgentDefinition[] = [
  { kind: "claude", label: "Claude Code", command: "claude" },
  { kind: "codex", label: "Codex", command: "codex" },
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
              "--output-format",
              "json",
            ]
          : [
              "-p",
              prompt,
              "--dangerously-skip-permissions",
              "--output-format",
              "stream-json",
              "--verbose",
            ],
    };
  }
  return {
    command: agent.command,
    args: [
      "exec",
      "--sandbox",
      permission === "read-only" ? "read-only" : "danger-full-access",
      "--skip-git-repo-check",
      prompt,
    ],
  };
};

export const getAuthInvocation = (
  agent: AgentDefinition,
): AgentInvocation => ({
  command: agent.command,
  args: agent.kind === "claude" ? ["auth", "status"] : ["login", "status"],
});

export const runAgent: AgentRunner = (
  invocation,
  { cwd, env, stdio = "pipe", timeoutMs = 30_000 },
) =>
  new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${invocation.command} check timed out.`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout });
      } else {
        reject(
          new Error(
            `${invocation.command} exited with ${signal ?? code}: ${stderr.trim()}`,
          ),
        );
      }
    });
  });

export const checkAgent = async (
  agent: AgentDefinition,
  cwd: string,
  runner: AgentRunner = runAgent,
): Promise<AgentCheck> => {
  try {
    await runner(
      { command: agent.command, args: ["--version"] },
      { cwd, timeoutMs: 10_000 },
    );
  } catch {
    return {
      agent,
      discovered: false,
      authenticated: false,
      readOnlyReady: false,
      detail: "Executable not found.",
    };
  }

  try {
    await runner(getAuthInvocation(agent), { cwd, timeoutMs: 15_000 });
  } catch (error) {
    return {
      agent,
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
      discovered: true,
      authenticated: true,
      readOnlyReady: true,
    };
  } catch (error) {
    return {
      agent,
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
  apiKey: string,
  resultFile: string,
  runner: AgentRunner = runAgent,
): Promise<void> => {
  await runner(buildAgentInvocation(agent, "full", prompt), {
    cwd,
    env: {
      ...process.env,
      CONFIDENT_API_KEY: apiKey,
      CONFIDENT_SETUP_RESULT_FILE: resultFile,
    },
    stdio: "inherit",
    timeoutMs: 30 * 60_000,
  });
};

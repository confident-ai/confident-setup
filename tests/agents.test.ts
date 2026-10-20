import { describe, expect, it, vi } from "vitest";

import {
  buildAgentInvocation,
  checkAgent,
  describeAgentCheck,
  executeAgent,
  findAgentCandidates,
  getAuthInvocation,
  supportedAgents,
  type AgentRunner,
} from "../src/agents.js";

describe("agent arguments", () => {
  it("uses plan/read-only before Claude full permission", () => {
    const claude = supportedAgents[0]!;
    expect(buildAgentInvocation(claude, "read-only", "prompt").args).toContain(
      "plan",
    );
    expect(buildAgentInvocation(claude, "full", "prompt").args).toContain(
      "--dangerously-skip-permissions",
    );
  });

  it("uses Cursor's ask mode before its unsandboxed run", () => {
    const cursor = supportedAgents[2]!;
    const readOnly = buildAgentInvocation(cursor, "read-only", "prompt");
    expect(readOnly.command).toBe("cursor-agent");
    expect(readOnly.args).toContain("ask");
    expect(readOnly.args).toContain("enabled");
    expect(readOnly.args).not.toContain("--force");

    const full = buildAgentInvocation(cursor, "full", "prompt");
    expect(full.args).toContain("--force");
    expect(full.args).toContain("--trust");
    expect(full.args).toContain("stream-json");
    // The CLI takes the prompt positionally, so it has to come last.
    expect(full.args.at(-1)).toBe("prompt");
  });

  it("asks each agent for its own authentication status", () => {
    expect(supportedAgents.map((agent) => getAuthInvocation(agent))).toEqual([
      { command: "claude", args: ["auth", "status"] },
      { command: "codex", args: ["login", "status"] },
      { command: "cursor-agent", args: ["status", "--format", "json"] },
    ]);
  });

  it("uses Codex sandbox levels", () => {
    const codex = supportedAgents[1]!;
    expect(buildAgentInvocation(codex, "read-only", "prompt").args).toContain(
      "read-only",
    );
    expect(buildAgentInvocation(codex, "full", "prompt").args).toContain(
      "danger-full-access",
    );
    expect(buildAgentInvocation(codex, "full", "prompt").args).toContain(
      "--json",
    );
  });
});

describe("agent checks and execution", () => {
  it("runs discovery, auth, and a read-only smoke check", async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue({ stdout: "ok" });
    const result = await checkAgent(supportedAgents[0]!, "/repo", runner, [
      { command: "claude", source: "path" },
    ]);
    expect(result).toMatchObject({
      discovered: true,
      authenticated: true,
      readOnlyReady: true,
    });
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("marks missing executables without further checks", async () => {
    const runner: AgentRunner = vi.fn().mockRejectedValue(new Error("ENOENT"));
    const result = await checkAgent(supportedAgents[1]!, "/repo", runner, [
      { command: "codex", source: "path" },
    ]);
    expect(result.discovered).toBe(false);
    expect(runner).toHaveBeenCalledOnce();
  });

  it("falls back to an off-PATH executable and runs that one", async () => {
    const desktop =
      "/Users/me/Library/Application Support/Claude/claude-code/2.1.0/abc/claude.app/Contents/MacOS/claude";
    const runner: AgentRunner = vi.fn(async ({ command }) => {
      if (command === "claude") throw new Error("ENOENT");
      return { stdout: "ok" };
    });
    const result = await checkAgent(supportedAgents[0]!, "/repo", runner, [
      { command: "claude", source: "path" },
      { command: desktop, source: "desktop-app" },
    ]);
    expect(result).toMatchObject({
      source: "desktop-app",
      readOnlyReady: true,
    });
    expect(result.agent.command).toBe(desktop);
    expect(vi.mocked(runner).mock.calls.at(-1)?.[0].command).toBe(desktop);
  });

  it("tells a signed-out user how to sign in", async () => {
    const desktop = "/Users/me/Library/Application Support/Claude/claude";
    const runner: AgentRunner = vi.fn(async ({ args }) => {
      if (args[0] === "auth") throw new Error("exited with 1");
      return { stdout: "ok" };
    });
    const result = await checkAgent(supportedAgents[0]!, "/repo", runner, [
      { command: desktop, source: "desktop-app" },
    ]);
    expect(result.authenticated).toBe(false);
    expect(describeAgentCheck(result)).toContain(
      "Claude Code (in the Claude desktop app): installed, not signed in",
    );
    expect(describeAgentCheck(result)).toContain(
      "'/Users/me/Library/Application Support/Claude/claude' auth login",
    );
  });

  it("finds the Claude desktop app's bundled CLI, newest first", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "agents-home-"));
    try {
      for (const version of ["2.1.9", "2.1.10"]) {
        const dir = join(
          home,
          "Library/Application Support/Claude/claude-code",
          version,
          "b",
          "claude.app/Contents/MacOS",
        );
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "claude"), "", { mode: 0o755 });
      }
      const candidates = await findAgentCandidates(supportedAgents[0]!, {
        home,
        platform: "darwin",
      });
      expect(candidates.map((c) => c.source)).toEqual([
        "path",
        "desktop-app",
        "desktop-app",
      ]);
      expect(candidates[1]!.command).toContain("/2.1.10/");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("finds the CLI bundled with the Codex editor extension", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "agents-home-"));
    try {
      for (const [editor, version] of [
        [".vscode", "26.901.22334"],
        [".cursor", "26.908.40401"],
        [".cursor", "26.800.1"],
      ] as const) {
        const dir = join(
          home,
          editor,
          "extensions",
          `openai.chatgpt-${version}-darwin-arm64`,
          "bin",
          "macos-aarch64",
        );
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "codex"), "", { mode: 0o755 });
      }
      const candidates = await findAgentCandidates(supportedAgents[1]!, {
        home,
        platform: "darwin",
      });
      expect(candidates.map((c) => c.source)).toEqual([
        "path",
        "editor-extension",
        "editor-extension",
        "editor-extension",
      ]);
      expect(candidates[1]!.command).toContain(".vscode");
      expect(candidates[2]!.command).toContain("26.908.40401");
      expect(
        describeAgentCheck({
          agent: { ...supportedAgents[1]!, command: candidates[1]!.command },
          source: "editor-extension",
          discovered: true,
          authenticated: false,
          readOnlyReady: false,
        }),
      ).toContain(
        "Codex (from the Codex editor extension): installed, not signed in",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("looks in the Windows install locations", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "agents-win-"));
    const env = {
      APPDATA: join(root, "Roaming"),
      LOCALAPPDATA: join(root, "Local"),
    };
    try {
      const files = [
        join(env.APPDATA, "Claude", "claude-code", "2.1.119", "claude.exe"),
        join(env.LOCALAPPDATA, "cursor-agent", "cursor-agent.exe"),
      ];
      for (const file of files) {
        await mkdir(join(file, ".."), { recursive: true });
        await writeFile(file, "", { mode: 0o755 });
      }
      const options = {
        home: join(root, "home"),
        platform: "win32" as const,
        env,
      };
      expect(await findAgentCandidates(supportedAgents[0]!, options)).toEqual([
        { command: "claude", source: "path" },
        { command: files[0], source: "desktop-app" },
      ]);
      expect(await findAgentCandidates(supportedAgents[2]!, options)).toEqual([
        { command: "cursor-agent", source: "path" },
        { command: files[1], source: "install-dir" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("injects secrets through env, never arguments", async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue({ stdout: "" });
    await executeAgent(
      supportedAgents[1]!,
      "/repo",
      "safe prompt",
      "super-secret",
      "/tmp/result.json",
      "/tmp/issues.json",
      runner,
    );
    const [invocation, options] = vi.mocked(runner).mock.calls[0]!;
    expect(invocation.args.join(" ")).not.toContain("super-secret");
    expect(options.env?.CONFIDENT_API_KEY).toBe("super-secret");
    expect(options.env?.CONFIDENT_SETUP_RESULT_FILE).toBe("/tmp/result.json");
    expect(options.env?.CONFIDENT_SETUP_ISSUES_FILE).toBe("/tmp/issues.json");
    expect(options.stdio).toBe("pipe");
  });

  it("omits CONFIDENT_API_KEY for local runs", async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue({ stdout: "" });
    vi.stubEnv("CONFIDENT_API_KEY", "existing");
    await executeAgent(
      supportedAgents[1]!,
      "/repo",
      "safe prompt",
      undefined,
      "/tmp/result.json",
      "/tmp/issues.json",
      runner,
    );
    expect(vi.mocked(runner).mock.calls[0]?.[1]?.env?.CONFIDENT_API_KEY).toBe(
      undefined,
    );
    vi.unstubAllEnvs();
  });
});

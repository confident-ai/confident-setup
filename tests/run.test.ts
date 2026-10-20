import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SetupResult, SetupResultOutcome } from "../src/result.js";
import {
  finishAgentRun,
  finishManualRun,
  summarizeResult,
  type RunContext,
  type RunIo,
} from "../src/run.js";
import type { TraceVerification } from "../src/verification.js";

const context: RunContext = {
  appUrl: "https://app.example",
  projectId: "project-1",
  apiKey: "confident_us_secret",
};

const tracesUrl = "https://app.example/project/project-1/observatory/traces";

const found: TraceVerification = {
  status: "found",
  trace: { uuid: "trace-1", name: "answer" },
  traceUrl: `${tracesUrl}/trace-1`,
  tracesUrl,
};

const completed: SetupResult = {
  status: "completed",
  changedFiles: ["app.py"],
  sdks: ["confident-trace-python"],
  integrations: ["OpenAI"],
  runCommand: "uv run --env-file .env.local python app.py",
  runSucceeded: true,
};

const accepted = (result: SetupResult): SetupResultOutcome => ({
  ok: true,
  result,
});

const fakeIo = (
  answers: { ran?: boolean; verification?: TraceVerification } = {},
) => {
  const shown: string[] = [];
  const io = {
    info: vi.fn((message: string) => void shown.push(message)),
    warn: vi.fn((message: string) => void shown.push(message)),
    note: vi.fn(
      (message: string, title: string) => void shown.push(title, message),
    ),
    confirmRan: vi.fn(async (message: string) => {
      shown.push(message);
      return answers.ran ?? true;
    }),
    verify: vi.fn(async () => answers.verification ?? found),
  } satisfies RunIo;
  return { io, text: () => shown.join("\n") };
};

describe("after a completed agent run", () => {
  it("verifies straight away and links the trace", async () => {
    const { io, text } = fakeIo();
    await expect(
      finishAgentRun(accepted(completed), context, io),
    ).resolves.toBe("verified");
    expect(io.confirmRan).not.toHaveBeenCalled();
    expect(io.verify).toHaveBeenCalledOnce();
    expect(text()).toContain("Trace: answer");
    expect(text()).toContain(`${tracesUrl}/trace-1`);
    expect(text()).toContain("Integrations: OpenAI");
  });

  it("names the trace id when the project is unknown", async () => {
    const { io, text } = fakeIo({
      verification: { status: "found", trace: { uuid: "trace-9" }, tracesUrl },
    });
    await finishAgentRun(
      accepted(completed),
      { ...context, projectId: undefined },
      io,
    );
    expect(text()).toContain("Trace ID: trace-9");
    expect(text()).toContain("https://app.example");
  });

  it("prints next steps when no trace arrives", async () => {
    const { io, text } = fakeIo({
      verification: { status: "timeout", tracesUrl },
    });
    await expect(
      finishAgentRun(accepted(completed), context, io),
    ).resolves.toBe("unverified");
    expect(text()).toContain("No trace reached Confident AI within 3 minutes");
    expect(text()).toContain(completed.runCommand);
    expect(text()).toContain(tracesUrl);
    expect(text()).toContain("llm-tracing/troubleshooting");
    expect(text()).toContain("left in place");
  });

  it("passes a verification error on to the user", async () => {
    const { io, text } = fakeIo({
      verification: {
        status: "error",
        message: "Confident AI does not allow listing traces (403).",
        tracesUrl,
      },
    });
    await expect(
      finishAgentRun(accepted(completed), context, io),
    ).resolves.toBe("unverified");
    expect(text()).toContain("does not allow listing traces (403)");
  });
});

describe("after a partial agent run", () => {
  const partial: SetupResult = {
    ...completed,
    status: "partial",
    runSucceeded: false,
    needsFromUser: ["Set OPENAI_API_KEY in your shell"],
  };

  it("shows what is needed, then verifies once the user ran it", async () => {
    const { io } = fakeIo({ ran: true });
    await expect(finishAgentRun(accepted(partial), context, io)).resolves.toBe(
      "verified",
    );
    const question = io.confirmRan.mock.calls[0]![0];
    expect(question).toContain("Set OPENAI_API_KEY in your shell");
    expect(question).toContain(partial.runCommand);
    expect(io.verify).toHaveBeenCalledOnce();
  });

  it("defers without checking when the user will run it later", async () => {
    const { io, text } = fakeIo({ ran: false });
    await expect(finishAgentRun(accepted(partial), context, io)).resolves.toBe(
      "deferred",
    );
    expect(io.verify).not.toHaveBeenCalled();
    expect(text()).toContain(tracesUrl);
  });
});

describe("after a failed agent run", () => {
  const failed: SetupResult = {
    ...completed,
    status: "failed",
    sdks: [],
    runCommand: "",
    runSucceeded: false,
    errors: ["The project needs Python 3.10 or newer; found 3.8."],
  };

  it("shows the errors and next steps without verifying", async () => {
    const { io, text } = fakeIo();
    await expect(finishAgentRun(accepted(failed), context, io)).resolves.toBe(
      "failed",
    );
    expect(io.verify).not.toHaveBeenCalled();
    expect(io.confirmRan).not.toHaveBeenCalled();
    expect(text()).toContain("Python 3.10 or newer");
    expect(text()).toContain("llm-tracing/troubleshooting");
  });

  it("leaves instrumentation and credentials on disk", async () => {
    const project = await mkdtemp(join(tmpdir(), "confident-run-"));
    try {
      await writeFile(join(project, "app.py"), "import confident_trace\n");
      await writeFile(join(project, ".env.local"), 'CONFIDENT_API_KEY="k"\n');
      const before = (await readdir(project)).sort();

      const outcomes: SetupResultOutcome[] = [
        accepted(failed),
        { ok: false, rejected: { issues: ["status: invalid"], salvaged: {} } },
      ];
      for (const outcome of outcomes) {
        const { io } = fakeIo({
          ran: true,
          verification: { status: "timeout", tracesUrl },
        });
        await finishAgentRun(outcome, context, io);
      }

      expect((await readdir(project)).sort()).toEqual(before);
      expect(await readFile(join(project, ".env.local"), "utf8")).toContain(
        "CONFIDENT_API_KEY",
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe("after a result the contract rejects", () => {
  it("shows what was salvaged and still offers the trace check", async () => {
    const { io, text } = fakeIo({ ran: true });
    await expect(
      finishAgentRun(
        {
          ok: false,
          rejected: {
            issues: ["runSucceeded: A completed setup must have run the app."],
            salvaged: { runCommand: "node app.js", changedFiles: ["app.js"] },
          },
        },
        context,
        io,
      ),
    ).resolves.toBe("verified");
    expect(text()).toContain("must have run the app");
    expect(text()).toContain("Changed files: app.js");
    expect(io.confirmRan.mock.calls[0]![0]).toContain("node app.js");
  });
});

describe("the key never reaches the screen", () => {
  it("scrubs it from anything the agent reported", async () => {
    const { io, text } = fakeIo({
      verification: { status: "timeout", tracesUrl },
    });
    await finishAgentRun(
      accepted({
        ...completed,
        runCommand: `CONFIDENT_API_KEY=${context.apiKey} python app.py`,
      }),
      context,
      io,
    );
    expect(text()).not.toContain(context.apiKey);
    expect(text()).toContain("CONFIDENT_API_KEY=[redacted] python app.py");
  });
});

describe("manual setup", () => {
  it("asks whether the app ran, then verifies without an id", async () => {
    const { io } = fakeIo({ ran: true });
    await expect(finishManualRun(context, io)).resolves.toBe("verified");
    expect(io.confirmRan.mock.calls[0]![0]).toContain("llm-tracing/quickstart");
    expect(io.verify).toHaveBeenCalledOnce();
  });

  it("defers with the quickstart link", async () => {
    const { io, text } = fakeIo({ ran: false });
    await expect(finishManualRun(context, io)).resolves.toBe("deferred");
    expect(io.verify).not.toHaveBeenCalled();
    expect(text()).toContain("llm-tracing/quickstart");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("result summary", () => {
  it("says how many times the AI was called when the agent reports it", () => {
    expect(summarizeResult({ ...completed, tracedRuns: 8 })).toContain(
      "App ran: yes (called your AI 8 times)",
    );
    expect(summarizeResult({ ...completed, tracedRuns: 1 })).toContain(
      "(called your AI once)",
    );
    expect(summarizeResult(completed)).not.toContain("called your AI");
  });
});

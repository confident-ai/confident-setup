import { describe, expect, it } from "vitest";

import { parseAgentProgressLine } from "../src/agent-progress.js";

describe("agent progress rendering", () => {
  it("turns Claude tool events into concise progress lines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/repo/evals/smoke.py" },
          },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "python -m pytest evals" },
          },
        ],
      },
    });

    expect(parseAgentProgressLine("claude", line, "/repo")).toEqual([
      "edit: evals/smoke.py",
      "run: python -m pytest evals",
    ]);
  });

  it("turns Codex JSON events into concise progress lines", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "command_execution",
        status: "in_progress",
        command: "npm test",
      },
    });

    expect(parseAgentProgressLine("codex", line, "/repo")).toEqual([
      "run: npm test",
    ]);
  });

  it("ignores incidental non-JSON output", () => {
    expect(parseAgentProgressLine("claude", "Starting...", "/repo")).toEqual(
      [],
    );
  });
});

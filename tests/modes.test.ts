import { describe, expect, it } from "vitest";

import {
  deferredSetupMessage,
  fullPermissionWarning,
  listLabels,
  setupModeOptions,
  TRACING_QUICKSTART_URL,
} from "../src/modes.js";

describe("mode helpers", () => {
  it("defines all three setup modes", () => {
    expect(setupModeOptions().map((option) => option.value)).toEqual([
      "built-in",
      "own-agent",
      "manual",
    ]);
    expect(fullPermissionWarning("Codex")).toContain("full permission");
    expect(deferredSetupMessage("manual")).toContain(TRACING_QUICKSTART_URL);
    expect(deferredSetupMessage("own-agent")).toContain("run your app");
  });

  it("offers the tracing quickstart for manual setup", () => {
    const manual = setupModeOptions().at(-1);
    expect(manual?.label).toBe("Add tracing yourself");
    expect(manual?.hint).toContain("tracing quickstart");
    expect(TRACING_QUICKSTART_URL).toBe(
      "https://www.confident-ai.com/docs/llm-tracing/quickstart",
    );
  });

  it("names detected agents and explains paste-your-own-prompt", () => {
    const [detected, own] = setupModeOptions([{ label: "Claude Code" }]);
    expect(detected?.label).toBe("Use detected agent (Claude Code)");
    expect(detected?.hint).toBe(
      "We run Claude Code for you here and stream its progress",
    );
    expect(own?.label).toBe("Paste a setup prompt into your coding agent");
    expect(
      setupModeOptions([{ label: "Claude Code" }, { label: "Codex" }])[0]
        ?.label,
    ).toBe("Use a detected agent (Claude Code or Codex)");
    expect(
      setupModeOptions([
        { label: "Claude Code" },
        { label: "Codex" },
        { label: "Cursor CLI" },
      ])[0]?.label,
    ).toBe("Use a detected agent (Claude Code, Codex, or Cursor CLI)");
    expect(listLabels(["Claude Code", "Codex", "Cursor CLI"], "and")).toBe(
      "Claude Code, Codex, and Cursor CLI",
    );
    expect(listLabels(["Codex"], "and")).toBe("Codex");
  });
});

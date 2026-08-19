import { describe, expect, it } from "vitest";

import { buildAgentPrompt } from "../src/prompt.js";

const judgeProvider = {
  id: "anthropic" as const,
  label: "Anthropic",
  hint: "",
  secrets: [{ envVar: "ANTHROPIC_API_KEY", label: "Anthropic API key" }],
  settings: [{ envVar: "ANTHROPIC_MODEL_NAME", label: "Model" }],
  flags: { USE_ANTHROPIC_MODEL: "true" },
  precedence: 12,
};

describe("agent prompt", () => {
  it("names the judge provider and its variables, never a value", () => {
    const prompt = buildAgentPrompt("/tmp/app", "/tmp/result.json", true, {
      provider: judgeProvider,
    });
    expect(prompt).toContain("Judge model: Anthropic");
    expect(prompt).toContain("ANTHROPIC_API_KEY, ANTHROPIC_MODEL_NAME");
    expect(prompt).toContain("never open or echo those values");
    expect(prompt).toContain(
      "User consent for model-backed evaluation runs: granted",
    );
  });

  it("tells the agent to stay deterministic without a judge", () => {
    const prompt = buildAgentPrompt("/tmp/app", "/tmp/result.json", false);
    expect(prompt).toContain("Judge model: none configured");
    expect(prompt).toContain("do not add LLM-judge metrics");
  });
});

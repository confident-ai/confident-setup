import { describe, expect, it } from "vitest";

import {
  detectJudge,
  judgeEnvValues,
  judgeProviders,
  judgeRequirements,
} from "../src/judge.js";

const provider = (id: string) => {
  const found = judgeProviders.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
};

describe("judge detection", () => {
  it("treats a bare OpenAI key as ready, matching DeepEval's fallback", () => {
    expect(detectJudge({ OPENAI_API_KEY: "sk-test" })).toEqual({
      provider: provider("openai"),
      missing: [],
    });
  });

  it("finds nothing when the environment has no provider credentials", () => {
    expect(detectJudge({ PATH: "/usr/bin" })).toBeUndefined();
  });

  it("ignores an empty or whitespace-only key", () => {
    expect(detectJudge({ OPENAI_API_KEY: "   " })).toBeUndefined();
  });

  it("follows a USE_ flag over the OpenAI fallback", () => {
    expect(
      detectJudge({
        OPENAI_API_KEY: "sk-test",
        USE_ANTHROPIC_MODEL: "true",
        ANTHROPIC_API_KEY: "sk-ant",
        ANTHROPIC_MODEL_NAME: "claude",
      }),
    ).toEqual({ provider: provider("anthropic"), missing: [] });
  });

  it("accepts the boolean spellings DeepEval parses", () => {
    for (const value of ["true", "1", "yes", "YES"]) {
      expect(detectJudge({ USE_GEMINI_MODEL: value })?.provider.id).toBe(
        "gemini",
      );
    }
    expect(detectJudge({ USE_GEMINI_MODEL: "false" })).toBeUndefined();
  });

  it("reports what a selected provider still needs", () => {
    expect(detectJudge({ USE_ANTHROPIC_MODEL: "true" })).toEqual({
      provider: provider("anthropic"),
      missing: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL_NAME"],
    });
  });

  it("matches Ollama on its marker value rather than a boolean", () => {
    expect(
      detectJudge({
        USE_LOCAL_MODEL: "true",
        LOCAL_MODEL_API_KEY: "ollama",
        OLLAMA_MODEL_NAME: "llama3.1",
      }),
    ).toEqual({ provider: provider("ollama"), missing: [] });
    expect(
      detectJudge({ USE_LOCAL_MODEL: "true", LOCAL_MODEL_API_KEY: "other" }),
    ).toBeUndefined();
  });

  it("resolves competing flags by DeepEval's own precedence", () => {
    expect(
      detectJudge({
        USE_GEMINI_MODEL: "true",
        USE_ANTHROPIC_MODEL: "true",
      })?.provider.id,
    ).toBe("gemini");
  });
});

describe("judge environment values", () => {
  it("writes the key, the provider flag, and the required model name", () => {
    expect(
      judgeEnvValues(provider("anthropic"), {
        secret: "sk-ant",
        settings: { ANTHROPIC_MODEL_NAME: " claude-sonnet-4-5 " },
      }),
    ).toEqual({
      USE_ANTHROPIC_MODEL: "true",
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_MODEL_NAME: "claude-sonnet-4-5",
    });
  });

  it("needs no key for a local Ollama judge", () => {
    expect(
      judgeEnvValues(provider("ollama"), {
        settings: { OLLAMA_MODEL_NAME: "llama3.1" },
      }),
    ).toEqual({
      USE_LOCAL_MODEL: "true",
      LOCAL_MODEL_API_KEY: "ollama",
      OLLAMA_MODEL_NAME: "llama3.1",
    });
  });

  it("leaves OpenAI on DeepEval's defaults", () => {
    expect(judgeEnvValues(provider("openai"), { secret: "sk-test" })).toEqual({
      OPENAI_API_KEY: "sk-test",
    });
    expect(judgeRequirements(provider("openai"))).toEqual(["OPENAI_API_KEY"]);
  });
});

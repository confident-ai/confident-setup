import { describe, expect, it } from "vitest";

import {
  EU_OTEL_TRACES_ENDPOINT,
  OTEL_TRACES_ENDPOINT,
} from "../src/credentials.js";
import {
  buildAgentPrompt,
  getCanonicalPrompt,
  type AgentPromptContext,
} from "../src/prompt.js";
import { tracingSdks } from "../src/result.js";

const context: AgentPromptContext = {
  projectDirectory: "/repo/apps/agent",
  gitRoot: "/repo",
  resultFile: "/tmp/result.json",
  delivery: "built-in",
  keyInEnvLocal: true,
  otelEndpoint: OTEL_TRACES_ENDPOINT,
};

/**
 * The prompt reaches the bundle through a markdown import, so a bundler or
 * plugin regression could ship an agent an empty or truncated brief without
 * failing anything else.
 */
describe("canonical prompt", () => {
  it("arrives whole, with the contract src/result.ts validates against", () => {
    const prompt = getCanonicalPrompt();
    expect(prompt.startsWith("# Confident AI tracing setup")).toBe(true);
    expect(prompt.length).toBeGreaterThan(4000);
    expect(prompt).toContain("CONFIDENT_SETUP_RESULT_FILE");
    for (const literal of [
      "completed",
      "partial",
      "failed",
      ...tracingSdks,
      "changedFiles",
      "integrations",
      "runCommand",
      "runSucceeded",
      "needsFromUser",
      "errors",
    ]) {
      expect(prompt).toContain(literal);
    }
  });

  it("teaches confident-trace from its own API names", () => {
    const prompt = getCanonicalPrompt();
    for (const name of [
      "confident-trace",
      "ct.init()",
      "--import confident-trace/register",
      "confident-trace[openai-agents]",
      "instrumentOpenAI(client)",
      "ConfidentLangChainCallbackHandler",
      "ConfidentLangGraphCallbackHandler",
      "createVercelAITracer()",
      "ConfidentMastraExporter",
      "ConfidentOpenAIAgentsProcessor",
      "await tracing.shutdown()",
      "update_trace(thread_id=..., user_id=...)",
      "updateTrace({ threadId, userId })",
      "withSpan",
    ]) {
      expect(prompt).toContain(name);
    }
  });

  it("names the OpenTelemetry endpoint, protocol, and header to confirm", () => {
    const prompt = getCanonicalPrompt();
    expect(prompt).toContain(OTEL_TRACES_ENDPOINT);
    expect(prompt).toContain(EU_OTEL_TRACES_ENDPOINT);
    expect(prompt).toContain("x-confident-api-key");
    expect(prompt).toContain("Not gRPC");
    expect(prompt).toContain(
      "https://www.confident-ai.com/docs/integrations/opentelemetry",
    );
  });

  it("keeps the agent away from the key file and out of evaluation work", () => {
    const prompt = getCanonicalPrompt();
    expect(prompt).toContain("Never open, print, parse, search");
    expect(prompt).toContain("`.env.local`");
    expect(prompt).toContain("Tracing only");
    expect(prompt).toContain("Do not commit or push");
  });

  it("never mentions the evaluation SDK", () => {
    expect(getCanonicalPrompt()).not.toMatch(/deepeval/i);
  });
});

describe("agent prompt runtime context", () => {
  it("gives the working directory, git root, and result destination", () => {
    const prompt = buildAgentPrompt(context);
    expect(prompt).toContain("- Working directory: /repo/apps/agent");
    expect(prompt).toContain("- Git root: /repo");
    expect(prompt).toContain("- Result destination: /tmp/result.json");
    expect(prompt).toContain("also in CONFIDENT_SETUP_RESULT_FILE");
  });

  it("says when there is no repository to orient from", () => {
    expect(buildAgentPrompt({ ...context, gitRoot: undefined })).toContain(
      "- Git root: none",
    );
  });

  it("tells a built-in agent the key is already in its environment", () => {
    const prompt = buildAgentPrompt(context);
    expect(prompt).toContain(
      "CONFIDENT_API_KEY is already in your environment",
    );
    expect(prompt).toContain("must load that file without reading it");
  });

  it("tells a pasted prompt to load .env.local without reading it", () => {
    const prompt = buildAgentPrompt({ ...context, delivery: "pasted" });
    expect(prompt).toContain(
      "CONFIDENT_API_KEY is in .env.local; load it without reading it",
    );
    expect(prompt).toContain("CONFIDENT_SETUP_RESULT_FILE is not set for you");
  });

  it("points at the shell when the key never reached .env.local", () => {
    const prompt = buildAgentPrompt({
      ...context,
      delivery: "pasted",
      keyInEnvLocal: false,
    });
    expect(prompt).toContain("set in the user's shell environment");
    expect(prompt).not.toContain("load it without reading it");
  });

  it("names the region endpoint, never the key", () => {
    const us = buildAgentPrompt(context);
    expect(us).toContain(
      `- Region: US. OTLP traces endpoint: ${OTEL_TRACES_ENDPOINT}`,
    );

    const eu = buildAgentPrompt({
      ...context,
      otelEndpoint: EU_OTEL_TRACES_ENDPOINT,
    });
    expect(eu).toContain(
      `- Region: EU. OTLP traces endpoint: ${EU_OTEL_TRACES_ENDPOINT}`,
    );
    expect(eu).toContain("set CONFIDENT_OTEL_ENDPOINT");
    expect(eu).not.toMatch(/confident_(us|eu)_/);
  });

  it("never mentions the evaluation SDK", () => {
    expect(buildAgentPrompt(context)).not.toMatch(/deepeval/i);
  });
});

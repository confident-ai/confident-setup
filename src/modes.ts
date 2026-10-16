export type SetupMode = "built-in" | "own-agent" | "manual";
export type PromptDelivery = "clipboard" | "terminal";

export interface DetectedAgentOption {
  label: string;
}

export const GITHUB_ISSUE_URL =
  "https://github.com/confident-ai/confident-setup/issues/new";
export const SUPPORT_URL = "https://www.confident-ai.com/contact";
export const TRACING_DOCS_URL =
  "https://www.confident-ai.com/docs/llm-tracing/introduction";
export const TRACING_QUICKSTART_URL =
  "https://www.confident-ai.com/docs/llm-tracing/quickstart";
export const TRACING_TROUBLESHOOTING_URL =
  "https://www.confident-ai.com/docs/llm-tracing/troubleshooting";

/** "A or B", "A, B, or C" — as many agents as the machine has installed. */
export const listLabels = (
  names: string[],
  conjunction: "and" | "or",
): string =>
  names.length <= 2
    ? names.join(` ${conjunction} `)
    : `${names.slice(0, -1).join(", ")}, ${conjunction} ${names.at(-1)}`;

export const setupModeOptions = (
  detectedAgents: DetectedAgentOption[] = [],
): Array<{
  value: SetupMode;
  label: string;
  hint: string;
}> => {
  const names = detectedAgents.map((agent) => agent.label);
  const detectedLabel =
    names.length === 1
      ? `Use detected agent (${names[0]})`
      : names.length > 1
        ? `Use a detected agent (${listLabels(names, "or")})`
        : "Use a detected coding agent";
  const detectedHint =
    names.length === 1
      ? `We run ${names[0]} for you here and stream its progress`
      : "We run the agent for you here and stream its progress";

  return [
    {
      value: "built-in",
      label: detectedLabel,
      hint: detectedHint,
    },
    {
      value: "own-agent",
      label: "Paste a setup prompt into your coding agent",
      hint: "Copy the prompt, paste it into your own agent, then return here",
    },
    {
      value: "manual",
      label: "Add tracing yourself",
      hint: "Open the tracing quickstart and follow it",
    },
  ];
};

export const promptDeliveryOptions: Array<{
  value: PromptDelivery;
  label: string;
  hint: string;
}> = [
  {
    value: "clipboard",
    label: "Copy the prompt to the clipboard",
    hint: "Paste it into your coding agent as the next message",
  },
  {
    value: "terminal",
    label: "Print the prompt in this terminal",
    hint: "Copy it from here into your coding agent",
  },
];

export const fullPermissionWarning = (agentLabel: string): string =>
  `${agentLabel} will be given full permission to edit files and run commands in this project. Review its output and the resulting diff. No commits or pushes are requested.`;

export const deferredSetupMessage = (
  mode: Exclude<SetupMode, "built-in">,
): string =>
  mode === "manual"
    ? `Finish adding tracing with ${TRACING_QUICKSTART_URL}, then run your app.`
    : "When your agent finishes, run your app with the command it reports.";

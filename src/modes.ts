export type SetupMode = "built-in" | "own-agent" | "manual";
export type PromptDelivery = "clipboard" | "terminal";

export interface DetectedAgentOption {
  label: string;
}

export const GITHUB_ISSUE_URL =
  "https://github.com/confident-ai/confident-setup/issues/new";
export const SUPPORT_URL = "https://www.confident-ai.com/contact";
export const EVALUATION_DOCS_URL =
  "https://www.confident-ai.com/docs/llm-evaluation";
export const MANUAL_QUICKSTART_URL =
  "https://www.confident-ai.com/docs/llm-evaluation/quickstart";

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
        ? `Use a detected agent (${names.join(" or ")})`
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
      hint: "Copy the prompt, paste it into Cursor or another agent, then return here",
    },
    {
      value: "manual",
      label: "Follow the DeepEval docs yourself",
      hint: "Open the evaluation quickstart and wire DeepEval up manually",
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

export const judgeSkipWarning =
  "No judge model configured, so LLM-judge metrics cannot run. The evaluation will stick to deterministic metrics. Add a provider key to .env.local later and rerun the evaluation to enable them.";

export const fullPermissionWarning = (agentLabel: string): string =>
  `${agentLabel} will be given full permission to edit files and run commands in this project. Review its output and the resulting diff. No commits or pushes are requested.`;

export const deferredSetupMessage = (
  mode: Exclude<SetupMode, "built-in">,
): string =>
  mode === "manual"
    ? `Finish the evaluation later with ${MANUAL_QUICKSTART_URL}`
    : "Paste the supplied prompt into your coding agent. Return here after it finishes if you want the wizard to verify the test run.";

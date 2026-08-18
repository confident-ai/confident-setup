export type SetupMode = "built-in" | "own-agent" | "manual";
export type PromptDelivery = "clipboard" | "terminal";

export const GITHUB_ISSUE_URL =
  "https://github.com/confident-ai/confident-setup/issues/new";
export const SUPPORT_URL = "https://www.confident-ai.com/contact";
export const EVALUATION_DOCS_URL =
  "https://www.confident-ai.com/docs/llm-evaluation";
export const MANUAL_QUICKSTART_URL =
  "https://www.confident-ai.com/docs/llm-evaluation/quickstart";

export const setupModeOptions: Array<{
  value: SetupMode;
  label: string;
  hint: string;
}> = [
  {
    value: "built-in",
    label: "Use built-in coding agent",
    hint: "Launch a locally installed coding agent",
  },
  {
    value: "own-agent",
    label: "Use your own coding agent",
    hint: "Copy a suggested prompt into your agent",
  },
  {
    value: "manual",
    label: "Set up manually",
    hint: "Use the DeepEval evaluation docs",
  },
];

export const promptDeliveryOptions: Array<{
  value: PromptDelivery;
  label: string;
  hint: string;
}> = [
  {
    value: "clipboard",
    label: "Copy to clipboard",
    hint: "Paste it into your coding agent",
  },
  {
    value: "terminal",
    label: "Print to terminal",
    hint: "Review or copy the full prompt here",
  },
];

export const fullPermissionWarning = (agentLabel: string): string =>
  `${agentLabel} will be given full permission to edit files and run commands in this project. Review its output and the resulting diff. No commits or pushes are requested.`;

export const deferredSetupMessage = (
  mode: Exclude<SetupMode, "built-in">,
): string =>
  mode === "manual"
    ? `Finish the evaluation later with ${MANUAL_QUICKSTART_URL}`
    : "Run the supplied prompt in your agent. The wizard can verify the test run after the agent returns a structured result.";

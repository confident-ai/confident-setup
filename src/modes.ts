export type SetupMode = "built-in" | "own-agent" | "manual";
export type PromptDelivery = "clipboard" | "terminal";

export const MANUAL_QUICKSTART_URL =
  "https://www.confident-ai.com/docs/llm-evaluation/quickstart";

export const setupModeOptions: Array<{
  value: SetupMode;
  label: string;
  hint: string;
}> = [
  {
    value: "built-in",
    label: "Use a built-in coding agent",
    hint: "Claude Code or Codex edits and runs the evaluation",
  },
  {
    value: "own-agent",
    label: "Use my own agent",
    hint: "Copy or print the canonical setup prompt",
  },
  {
    value: "manual",
    label: "Set up manually",
    hint: "Continue with the DeepEval quickstart",
  },
];

export const promptDeliveryOptions: Array<{
  value: PromptDelivery;
  label: string;
}> = [
  { value: "clipboard", label: "Copy prompt to clipboard" },
  { value: "terminal", label: "Print prompt in this terminal" },
];

export const fullPermissionWarning = (agentLabel: string): string =>
  `${agentLabel} will be given full permission to edit files and run commands in this project. Review its output and the resulting diff. No commits or pushes are requested.`;

export const deferredSetupMessage = (
  mode: Exclude<SetupMode, "built-in">,
): string =>
  mode === "manual"
    ? `Finish the evaluation later with ${MANUAL_QUICKSTART_URL}`
    : "Run the supplied prompt in your agent. The wizard can verify the test run after the agent returns a structured result.";

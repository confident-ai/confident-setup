import canonicalPrompt from "../prompts/tracing.md";
import { EU_OTEL_TRACES_ENDPOINT } from "./credentials.js";

export const getCanonicalPrompt = (): string => canonicalPrompt.trim();

export type PromptDelivery = "built-in" | "pasted";

export interface AgentPromptContext {
  projectDirectory: string;
  gitRoot?: string | undefined;
  resultFile: string;
  /** Where the agent writes the issues to watch for; the wizard uploads them. */
  issuesFile: string;
  /** A built-in agent gets the key in its environment; a pasted prompt does not. */
  delivery: PromptDelivery;
  /** Whether `.env.local` holds the key, or only the user's shell does. */
  keyInEnvLocal: boolean;
  /**
   * Whether the user's shell exports a different CONFIDENT_API_KEY than the one
   * in `.env.local`, which most loaders would keep instead of the new key.
   */
  shellKeyDiffers?: boolean | undefined;
  /** Derived from the key's region. The key itself never enters the prompt. */
  otelEndpoint: string;
}

const describeGitRoot = (gitRoot: string | undefined): string =>
  gitRoot
    ? `- Git root: ${gitRoot}`
    : "- Git root: none. This folder is not inside a Git repository.";

/** Say where the key is and how to reach it, never what it is. */
const describeKey = ({
  delivery,
  keyInEnvLocal,
}: AgentPromptContext): string => {
  if (delivery === "built-in") {
    return keyInEnvLocal
      ? "- API key: CONFIDENT_API_KEY is already in your environment. It is also saved in .env.local, so the run command you report must load that file without reading it."
      : "- API key: CONFIDENT_API_KEY is already in your environment, set by the user's shell rather than .env.local. Rely on the environment and do not write the key anywhere.";
  }
  return keyInEnvLocal
    ? "- API key: CONFIDENT_API_KEY is in .env.local; load it without reading it, and you must not ask for its value. If your environment already has a CONFIDENT_API_KEY, it may be an older key for another project, so the .env.local value must replace it."
    : "- API key: CONFIDENT_API_KEY is set in the user's shell environment, not in .env.local. Rely on the environment. If your shell does not have it, report partial and ask the user to export it.";
};

const describeShellKey = ({
  keyInEnvLocal,
  shellKeyDiffers,
}: AgentPromptContext): string =>
  keyInEnvLocal && shellKeyDiffers
    ? "\n- Conflicting key: the user's shell exports a different CONFIDENT_API_KEY, for another project. The run command must override it with the .env.local value, or every trace goes to the wrong project."
    : "";

const describeRegion = (otelEndpoint: string): string =>
  otelEndpoint === EU_OTEL_TRACES_ENDPOINT
    ? `- Region: EU. OTLP traces endpoint: ${otelEndpoint}. confident-trace defaults to the US endpoint, so set CONFIDENT_OTEL_ENDPOINT to this value or pass it to init() as endpoint.`
    : `- Region: US. OTLP traces endpoint: ${otelEndpoint}. confident-trace uses it by default.`;

export const buildAgentPrompt = (context: AgentPromptContext): string =>
  `${getCanonicalPrompt()}

Runtime context:
- Working directory: ${context.projectDirectory}
${describeGitRoot(context.gitRoot)}
- Result destination: ${context.resultFile}${
    context.delivery === "built-in"
      ? " (also in CONFIDENT_SETUP_RESULT_FILE)"
      : " (CONFIDENT_SETUP_RESULT_FILE is not set for you, so write to this path)"
  }
- Issues destination: ${context.issuesFile}${
    context.delivery === "built-in"
      ? " (also in CONFIDENT_SETUP_ISSUES_FILE)"
      : " (CONFIDENT_SETUP_ISSUES_FILE is not set for you, so write to this path)"
  }
${describeKey(context)}${describeShellKey(context)}
${describeRegion(context.otelEndpoint)}

Only instrument applications in or below the working directory.`;

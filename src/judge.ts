/**
 * Judge-model credentials for DeepEval's LLM metrics.
 *
 * DeepEval resolves a judge provider by first-match on its `USE_*` flags and
 * otherwise falls back to OpenAI, reading every secret from the process
 * environment or an autoloaded dotenv (`.env.local` wins among files). This
 * mirrors that resolution so the wizard can tell whether metrics can actually
 * run before an agent spends a turn finding out.
 */

export type JudgeProviderId =
  "openai" | "anthropic" | "gemini" | "azure-openai" | "openrouter" | "ollama";

export interface JudgeSetting {
  envVar: string;
  label: string;
  placeholder?: string;
}

export interface JudgeProvider {
  id: JudgeProviderId;
  label: string;
  hint: string;
  /** Prompted masked. Absent for providers that authenticate without a key. */
  secretEnvVar?: string;
  /** Non-secret values DeepEval requires before the provider can run. */
  settings: JudgeSetting[];
  /**
   * Written verbatim so DeepEval selects this provider, and matched to detect
   * it. `"true"` matches DeepEval's boolean parsing; anything else is exact.
   * OpenAI needs no flag because it is DeepEval's fallback.
   */
  flags: Record<string, string>;
  /** DeepEval's own `initialize_model` order, for multi-flag environments. */
  precedence: number;
}

export const judgeProviders: readonly JudgeProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    hint: "DeepEval's default judge; needs nothing but the key",
    secretEnvVar: "OPENAI_API_KEY",
    settings: [],
    flags: {},
    precedence: 1,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Claude as the judge; DeepEval requires an explicit model name",
    secretEnvVar: "ANTHROPIC_API_KEY",
    settings: [
      {
        envVar: "ANTHROPIC_MODEL_NAME",
        label: "Anthropic model name",
        placeholder: "claude-sonnet-4-5",
      },
    ],
    flags: { USE_ANTHROPIC_MODEL: "true" },
    precedence: 11,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    hint: "Gemini as the judge; uses DeepEval's default model",
    secretEnvVar: "GOOGLE_API_KEY",
    settings: [],
    flags: { USE_GEMINI_MODEL: "true" },
    precedence: 2,
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    hint: "Your Azure deployment; needs endpoint and deployment details",
    secretEnvVar: "AZURE_OPENAI_API_KEY",
    settings: [
      {
        envVar: "AZURE_OPENAI_ENDPOINT",
        label: "Azure OpenAI endpoint",
        placeholder: "https://my-resource.openai.azure.com",
      },
      {
        envVar: "AZURE_DEPLOYMENT_NAME",
        label: "Azure deployment name",
      },
      {
        envVar: "AZURE_MODEL_NAME",
        label: "Model behind that deployment",
      },
      {
        envVar: "OPENAI_API_VERSION",
        label: "Azure API version",
        placeholder: "2024-10-21",
      },
    ],
    flags: { USE_AZURE_OPENAI: "true" },
    precedence: 7,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "Any OpenRouter model; uses DeepEval's default model",
    secretEnvVar: "OPENROUTER_API_KEY",
    settings: [],
    flags: { USE_OPENROUTER_MODEL: "true" },
    precedence: 10,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    hint: "No API key and no provider spend; needs Ollama running locally",
    settings: [
      {
        envVar: "OLLAMA_MODEL_NAME",
        label: "Ollama model name",
        placeholder: "llama3.1",
      },
    ],
    flags: { USE_LOCAL_MODEL: "true", LOCAL_MODEL_API_KEY: "ollama" },
    precedence: 5,
  },
];

export type EnvValues = Record<string, string | undefined>;

export interface JudgeStatus {
  provider: JudgeProvider;
  /** Environment variables the provider still needs. */
  missing: string[];
}

const isTruthy = (value: string | undefined): boolean =>
  ["true", "1", "yes"].includes((value ?? "").trim().toLowerCase());

const isFilled = (value: string | undefined): boolean =>
  (value ?? "").trim().length > 0;

/** Every variable a provider needs before DeepEval can call it. */
export const judgeRequirements = (provider: JudgeProvider): string[] => [
  ...(provider.secretEnvVar ? [provider.secretEnvVar] : []),
  ...provider.settings.map((setting) => setting.envVar),
];

/** The provider's requirements this environment cannot satisfy yet. */
export const judgeMissing = (
  provider: JudgeProvider,
  env: EnvValues,
): string[] =>
  judgeRequirements(provider).filter((envVar) => !isFilled(env[envVar]));

/** Which judge DeepEval would pick, and what it is still missing. */
export const detectJudge = (env: EnvValues): JudgeStatus | undefined => {
  const flagged = judgeProviders
    .filter((provider) => Object.keys(provider.flags).length > 0)
    .sort((left, right) => left.precedence - right.precedence)
    .find((provider) =>
      Object.entries(provider.flags).every(([envVar, value]) =>
        value === "true"
          ? isTruthy(env[envVar])
          : (env[envVar] ?? "").trim() === value,
      ),
    );
  const provider =
    flagged ??
    (isFilled(env.OPENAI_API_KEY)
      ? judgeProviders.find((candidate) => candidate.id === "openai")
      : undefined);
  if (!provider) return undefined;
  return { provider, missing: judgeMissing(provider, env) };
};

/** The values to write for a provider, given the answers collected. */
export const judgeEnvValues = (
  provider: JudgeProvider,
  answers: { secret?: string; settings?: Record<string, string> },
): Record<string, string> => {
  const values: Record<string, string> = { ...provider.flags };
  if (provider.secretEnvVar && answers.secret) {
    values[provider.secretEnvVar] = answers.secret;
  }
  for (const setting of provider.settings) {
    const value = answers.settings?.[setting.envVar]?.trim();
    if (value) values[setting.envVar] = value;
  }
  return values;
};

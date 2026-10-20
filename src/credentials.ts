import { CONFIDENT_API_KEY, readEnvValues } from "./env.js";

/** Where an existing key was found. The shell wins, as it does for the SDK. */
export type KeySource = "environment" | "env-local";

export interface ExistingKey {
  apiKey: string;
  source: KeySource;
  /** Whether `.env.local` holds this same key, so a fresh shell can load it. */
  inEnvLocal: boolean;
}

export interface Credentials {
  apiKey: string;
  /**
   * Unknown when an existing key is reused: no public endpoint maps a project
   * key to its project, so links fall back to the app instead of deep links.
   */
  projectId?: string;
  inEnvLocal: boolean;
  reused: boolean;
  /** Whether sign-in created the account, rather than choosing a project. */
  newAccount?: boolean;
  /** Set when a reused key belongs to another region than `--api-url`. */
  apiUrl?: string;
}

const DEFAULT_API_URL = "https://api.confident-ai.com";
const EU_API_URL = "https://eu.api.confident-ai.com";

/**
 * A `confident_eu_` key only works against the EU API, so a check against the
 * default US API would wrongly reject it. An explicit `--api-url` is left alone.
 */
export const apiUrlForKey = (apiUrl: string, apiKey: string): string =>
  apiUrl.replace(/\/+$/, "") === DEFAULT_API_URL &&
  apiKey.startsWith("confident_eu_")
    ? EU_API_URL
    : apiUrl;

export const OTEL_TRACES_ENDPOINT = "https://otel.confident-ai.com/v1/traces";
export const EU_OTEL_TRACES_ENDPOINT =
  "https://eu.otel.confident-ai.com/v1/traces";

/** Keys carry their region, so only the endpoint ever leaves this function. */
export const otelEndpointForKey = (apiKey: string): string =>
  apiKey.startsWith("confident_eu_")
    ? EU_OTEL_TRACES_ENDPOINT
    : OTEL_TRACES_ENDPOINT;

export const findExistingKey = async (
  projectDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  readValues: (
    directory: string,
  ) => Promise<Record<string, string>> = readEnvValues,
): Promise<ExistingKey | undefined> => {
  const local = (await readValues(projectDirectory))[CONFIDENT_API_KEY]?.trim();
  const shell = env[CONFIDENT_API_KEY]?.trim();
  if (shell) {
    return {
      apiKey: shell,
      source: "environment",
      inEnvLocal: local === shell,
    };
  }
  if (local) return { apiKey: local, source: "env-local", inEnvLocal: true };
  return undefined;
};

export type KeyCheck =
  | { status: "accepted"; warning?: string }
  | { status: "rejected"; message: string }
  | { status: "wrong-project"; message: string }
  | { status: "unconfirmed"; message: string };

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();
    if (
      body !== null &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // Keep the status-only message when the body is not JSON.
  }
  return `HTTP ${response.status}`;
};

/**
 * One authenticated read of the endpoint the trace check uses later. With a
 * project id, the API also requires the key to belong to that project and
 * answers 400 when it does not.
 *
 * The license gate answers 403 before any key is looked at, so a 403 says the
 * deployment does not list traces at all. Without a project to confirm, the key
 * is kept, since a new one would hit the same gate; with one, the project went
 * unconfirmed and signing in is the safer route.
 */
export const checkKey = async (
  apiUrl: string,
  apiKey: string,
  projectId: string | undefined,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<KeyCheck> => {
  const scrub = (message: string): string =>
    message.replaceAll(apiKey, "[redacted]");
  let response: Response;
  try {
    response = await fetchImplementation(
      `${apiUrl.replace(/\/+$/, "")}/v2/traces?pageSize=1`,
      {
        headers: {
          CONFIDENT_API_KEY: apiKey,
          ...(projectId ? { "confident-project-id": projectId } : {}),
        },
      },
    );
  } catch (error) {
    return {
      status: "unconfirmed",
      message: scrub(
        `Could not reach Confident AI: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  if (response.ok) return { status: "accepted" };

  const detail = scrub(await readErrorMessage(response));
  if (response.status === 401) return { status: "rejected", message: detail };
  if (response.status === 400 && projectId) {
    return { status: "wrong-project", message: detail };
  }
  if (response.status === 403 && !projectId) {
    return {
      status: "accepted",
      warning: `Confident AI answered 403 (${detail}), so the trace check at the end may fail the same way.`,
    };
  }
  return {
    status: "unconfirmed",
    message: `Confident AI answered ${response.status} (${detail}).`,
  };
};

export interface CredentialDependencies {
  env?: NodeJS.ProcessEnv;
  readEnvValues?: (directory: string) => Promise<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
  /** Ask whether to reuse the key. It is never shown, only where it was found. */
  chooseReuse: (key: Omit<ExistingKey, "apiKey">) => Promise<boolean>;
  /** Runs the key check, typically behind a spinner. */
  checking?: <T>(work: () => Promise<T>) => Promise<T>;
  info: (message: string) => void;
  warn: (message: string) => void;
}

const describeSource = (source: KeySource): string =>
  source === "env-local" ? ".env.local" : "your shell environment";

/**
 * Reuse a key this project already has when the user agrees and Confident AI
 * accepts it; otherwise sign in, which creates a new key. The reused key is
 * never written anywhere, printed, or put in a message.
 */
export const resolveCredentials = async (
  options: {
    projectDir: string;
    apiUrl: string;
    orgId?: string | undefined;
    projId?: string | undefined;
  },
  signIn: () => Promise<Credentials>,
  dependencies: CredentialDependencies,
): Promise<Credentials> => {
  // A project key cannot prove which organization it belongs to.
  if (options.orgId && !options.projId) return signIn();

  const existing = await findExistingKey(
    options.projectDir,
    dependencies.env,
    dependencies.readEnvValues,
  );
  if (!existing) return signIn();

  const { apiKey, ...location } = existing;
  if (!(await dependencies.chooseReuse(location))) return signIn();

  const apiUrl = apiUrlForKey(options.apiUrl, apiKey);
  const run = dependencies.checking ?? (<T>(work: () => Promise<T>) => work());
  const check = await run(() =>
    checkKey(apiUrl, apiKey, options.projId, dependencies.fetch),
  );
  switch (check.status) {
    case "accepted":
      if (check.warning) dependencies.warn(check.warning);
      dependencies.info(
        `Using the Confident AI key from ${describeSource(existing.source)}. Skipping steps 1-3.`,
      );
      return {
        apiKey,
        inEnvLocal: existing.inEnvLocal,
        reused: true,
        ...(apiUrl !== options.apiUrl ? { apiUrl } : {}),
      };
    case "rejected":
      dependencies.warn(
        `Confident AI rejected this key (${check.message}). Sign in to create a new one.`,
      );
      return signIn();
    case "wrong-project":
      dependencies.warn(
        `This key does not belong to project ${options.projId ?? ""} (${check.message}). Sign in to create a key for it.`,
      );
      return signIn();
    case "unconfirmed":
      dependencies.warn(
        `Could not confirm this key. ${check.message} Sign in to create a new one.`,
      );
      return signIn();
  }
};

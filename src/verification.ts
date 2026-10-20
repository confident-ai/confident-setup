import { z } from "zod";

/**
 * One row of `GET /v2/traces`. Only the fields the wizard shows are checked, and
 * anything else the API adds is accepted, so a new column never fails setup.
 */
const traceSummarySchema = z
  .object({
    uuid: z.string().min(1),
    name: z.string().nullable().optional(),
  })
  .loose();

const traceListSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        traces: z.array(traceSummarySchema),
      })
      .loose(),
  })
  .loose();

const errorBodySchema = z.object({ error: z.string().min(1) }).loose();

export interface FoundTrace {
  uuid: string;
  name?: string;
}

export type TraceVerification =
  | {
      status: "found";
      /** The newest trace. */
      trace: FoundTrace;
      /** Traces found since setup started, up to `TRACE_PAGE_SIZE`. */
      count: number;
      /** Absent when the project is unknown, as on the reused-key path. */
      traceUrl?: string;
      tracesUrl: string;
    }
  | { status: "timeout"; tracesUrl: string }
  | { status: "error"; message: string; tracesUrl: string };

export interface TraceVerificationOptions {
  apiUrl: string;
  appUrl: string;
  apiKey: string;
  /** Unknown when an existing key was reused, so links fall back to the app. */
  projectId?: string | undefined;
  /** Only traces created at or after this moment count. */
  since: Date;
}

export interface TraceVerificationDependencies {
  fetch: typeof globalThis.fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  /** Called before each poll with the time spent waiting so far. */
  onPoll?: (elapsedMs: number) => void;
  intervalMs?: number;
  timeoutMs?: number;
}

/** Ingest to queryable takes roughly 35-95 s, so three minutes leaves margin. */
export const TRACE_POLL_INTERVAL_MS = 5_000;
export const TRACE_POLL_TIMEOUT_MS = 3 * 60_000;
/** Enough rows to count a 7-10 input batch, so the count rarely caps. */
export const TRACE_PAGE_SIZE = 25;

const defaultDependencies: TraceVerificationDependencies = {
  fetch: globalThis.fetch,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
};

const trimSlashes = (url: string): string => url.replace(/\/+$/, "");

export const buildTracesUrl = (appUrl: string, projectId?: string): string =>
  projectId
    ? `${trimSlashes(appUrl)}/project/${encodeURIComponent(projectId)}/observatory/traces`
    : trimSlashes(appUrl);

/**
 * The web onboarding page, which shows a new account's first traces arriving
 * and then opens the project's traces.
 */
export const buildOnboardingUrl = (appUrl: string): string =>
  `${trimSlashes(appUrl)}/onboarding`;

export const buildTraceUrl = (
  appUrl: string,
  projectId: string,
  traceUuid: string,
): string =>
  `${buildTracesUrl(appUrl, projectId)}/${encodeURIComponent(traceUuid)}`;

export const buildTraceListRequest = (apiUrl: string, since: Date): string => {
  const query = new URLSearchParams({
    start: since.toISOString(),
    pageSize: String(TRACE_PAGE_SIZE),
  });
  return `${trimSlashes(apiUrl)}/v2/traces?${query.toString()}`;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = errorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.error : `HTTP ${response.status}`;
};

/** A refusal no amount of waiting fixes, so polling stops on the first one. */
const isFinalRefusal = (status: number): boolean =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

const describeRefusal = (status: number, detail: string): string => {
  if (status === 401) {
    return `Confident AI rejected the API key while looking for traces (401: ${detail}).`;
  }
  if (status === 403) {
    return `Confident AI does not allow listing traces for this key (403: ${detail}).`;
  }
  return `Confident AI could not list traces (${status}: ${detail}).`;
};

/**
 * Poll the documented trace list for the first trace created since setup
 * started, and stop at the first page that has any. Newest traces come first by
 * default, so the first row is the newest and the page size caps the count. The
 * key travels only in the header the API reads, never in the URL or a message.
 */
export const verifyFirstTrace = async (
  options: TraceVerificationOptions,
  dependencies: Partial<TraceVerificationDependencies> = {},
): Promise<TraceVerification> => {
  const {
    fetch,
    sleep,
    now,
    onPoll,
    intervalMs = TRACE_POLL_INTERVAL_MS,
    timeoutMs = TRACE_POLL_TIMEOUT_MS,
  } = { ...defaultDependencies, ...dependencies };
  const tracesUrl = buildTracesUrl(options.appUrl, options.projectId);
  const request = buildTraceListRequest(options.apiUrl, options.since);
  const scrub = (message: string): string =>
    options.apiKey ? message.replaceAll(options.apiKey, "[redacted]") : message;

  const started = now();
  let answered = false;
  let lastProblem: string | undefined;

  for (;;) {
    onPoll?.(now() - started);
    try {
      const response = await fetch(request, {
        headers: { CONFIDENT_API_KEY: options.apiKey },
      });
      if (response.ok) {
        const parsed = traceListSchema.safeParse(
          await response.json().catch(() => undefined),
        );
        if (parsed.success) {
          answered = true;
          const { traces } = parsed.data.data;
          const [trace] = traces;
          if (trace) {
            return {
              status: "found",
              count: traces.length,
              trace: {
                uuid: trace.uuid,
                ...(trace.name ? { name: trace.name } : {}),
              },
              ...(options.projectId
                ? {
                    traceUrl: buildTraceUrl(
                      options.appUrl,
                      options.projectId,
                      trace.uuid,
                    ),
                  }
                : {}),
              tracesUrl,
            };
          }
        } else {
          lastProblem =
            "Confident AI returned a trace list setup could not read.";
        }
      } else if (isFinalRefusal(response.status)) {
        return {
          status: "error",
          message: scrub(
            describeRefusal(response.status, await readErrorMessage(response)),
          ),
          tracesUrl,
        };
      } else {
        lastProblem = `Confident AI could not list traces (${response.status}).`;
      }
    } catch (error) {
      lastProblem = scrub(
        `Could not reach Confident AI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (now() - started + intervalMs > timeoutMs) break;
    await sleep(intervalMs);
  }

  /** Never hearing back is a different problem from hearing "nothing yet". */
  return !answered && lastProblem
    ? { status: "error", message: lastProblem, tracesUrl }
    : { status: "timeout", tracesUrl };
};

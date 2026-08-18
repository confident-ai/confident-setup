const SENSITIVE_KEY =
  /api.?key|authorization|token|secret|password|email|path|prompt|command|file/i;
const SECRET_VALUE =
  /(Bearer\s+\S+|sk-[A-Za-z0-9_-]+|[A-Za-z]+_[A-Za-z0-9_-]{24,})/i;

export interface TelemetryEvent {
  event:
    | "wizard_started"
    | "authentication_started"
    | "authentication_completed"
    | "setup_started"
    | "setup_completed"
    | "setup_failed";
  step?:
    | "bootstrap"
    | "authentication"
    | "environment_detection"
    | "dependency_installation"
    | "configuration"
    | "evaluation";
  result?: "started" | "succeeded" | "failed" | "cancelled";
  errorCode?:
    | "unknown"
    | "network"
    | "permission_denied"
    | "invalid_configuration"
    | "command_failed"
    | "timeout";
  elapsedMs?: number;
}

export const redactTelemetry = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) return "[REDACTED]";
    return value.slice(0, 120);
  }
  if (Array.isArray(value)) return value.map(redactTelemetry);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactTelemetry(item),
      ]),
    );
  }
  return String(value).slice(0, 120);
};

export class SetupTelemetry {
  readonly #url: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #disabled: boolean;
  #eventToken: string | undefined;

  constructor(
    apiUrl: string,
    options: {
      fetch?: typeof globalThis.fetch;
      disabled?: boolean;
    } = {},
  ) {
    this.#url = `${apiUrl.replace(/\/+$/, "")}/cli/setup/events`;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#disabled =
      options.disabled ?? process.env.CONFIDENT_TELEMETRY_DISABLED === "1";
  }

  setEventToken(eventToken: string | undefined): void {
    this.#eventToken = eventToken;
  }

  async send(event: TelemetryEvent): Promise<void> {
    if (this.#disabled || !this.#eventToken) return;
    try {
      await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#eventToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(redactTelemetry(event)),
      });
    } catch {
      // Setup telemetry is intentionally best-effort.
    }
  }
}

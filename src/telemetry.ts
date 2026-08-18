const SENSITIVE_KEY =
  /api.?key|authorization|token|secret|password|email|path|prompt|command|file/i;
const SECRET_VALUE = /(Bearer\s+\S+|sk-[A-Za-z0-9_-]+|[A-Za-z]+_[A-Za-z0-9_-]{24,})/i;

export type TelemetryValue =
  | string
  | number
  | boolean
  | null
  | TelemetryValue[]
  | { [key: string]: TelemetryValue };

export interface TelemetryEvent {
  event: string;
  properties?: Record<string, TelemetryValue>;
}

export const redactTelemetry = (value: unknown): TelemetryValue => {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
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

  async send(event: TelemetryEvent): Promise<void> {
    if (this.#disabled) return;
    try {
      await this.#fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(redactTelemetry(event)),
      });
    } catch {
      // Setup telemetry is intentionally best-effort.
    }
  }
}

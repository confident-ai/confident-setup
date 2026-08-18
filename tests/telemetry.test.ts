import { describe, expect, it, vi } from "vitest";

import { redactTelemetry, SetupTelemetry } from "../src/telemetry.js";

describe("telemetry redaction", () => {
  it("redacts sensitive keys and token-shaped values recursively", () => {
    expect(
      redactTelemetry({
        mode: "built-in",
        apiKey: "secret",
        nested: {
          authorization: "Bearer token",
          detail: "proj_abcdefghijklmnopqrstuvwxyz1234",
        },
      }),
    ).toEqual({
      mode: "built-in",
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        detail: "[REDACTED]",
      },
    });
  });

  it("does not send when disabled", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const telemetry = new SetupTelemetry("https://api.example", {
      fetch,
      disabled: true,
    });
    await telemetry.send({ event: "setup_started" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never fails setup when posting fails", async () => {
    const telemetry = new SetupTelemetry("https://api.example", {
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(new Error("offline")),
      disabled: false,
    });
    await expect(
      telemetry.send({ event: "setup_finished" }),
    ).resolves.toBeUndefined();
  });
});

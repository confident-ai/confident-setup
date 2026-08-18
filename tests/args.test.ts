import { describe, expect, it } from "vitest";

import { parseArgs, requireInteractiveTty } from "../src/args.js";

describe("parseArgs", () => {
  it("uses production defaults and resolves --from", () => {
    expect(parseArgs(["--from", "app"], "/repo")).toMatchObject({
      from: "/repo/app",
      appUrl: "https://app.confident-ai.com",
      apiUrl: "https://api.confident-ai.com",
      help: false,
    });
  });

  it("parses IDs and strips URL trailing slashes", () => {
    expect(
      parseArgs([
        "--app-url",
        "https://app.example/",
        "--api-url",
        "https://api.example///",
        "--org-id",
        "org",
        "--proj-id",
        "project",
      ]),
    ).toMatchObject({
      appUrl: "https://app.example",
      apiUrl: "https://api.example",
      orgId: "org",
      projId: "project",
    });
  });

  it("rejects unknown and missing arguments", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--from"])).toThrow("requires a value");
    expect(() => parseArgs(["--api-url", "nope"])).toThrow();
  });
});

describe("requireInteractiveTty", () => {
  it("rejects non-interactive execution", () => {
    expect(() => requireInteractiveTty(false, true)).toThrow("interactive TTY");
    expect(() => requireInteractiveTty(true, false)).toThrow("interactive TTY");
    expect(() => requireInteractiveTty(true, true)).not.toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  apiUrlForKey,
  checkKey,
  EU_OTEL_TRACES_ENDPOINT,
  findExistingKey,
  OTEL_TRACES_ENDPOINT,
  otelEndpointForKey,
  resolveCredentials,
  type Credentials,
  type CredentialDependencies,
} from "../src/credentials.js";

const KEY = "confident_us_existing";

const options = {
  projectDir: "/repo",
  apiUrl: "https://api.example/",
};

const newKey: Credentials = {
  apiKey: "confident_us_new",
  projectId: "project-new",
  inEnvLocal: true,
  reused: false,
};

const respond = (status: number, body: unknown = { success: true }) =>
  vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));

const dependencies = (overrides: Partial<CredentialDependencies> = {}) => {
  const info = vi.fn<(message: string) => void>();
  const warn = vi.fn<(message: string) => void>();
  return {
    env: {},
    readEnvValues: async () => ({ CONFIDENT_API_KEY: KEY }),
    fetch: respond(200, { success: true, data: { traces: [] } }),
    chooseReuse: vi.fn(async () => true),
    ...overrides,
    info,
    warn,
  } satisfies CredentialDependencies;
};

describe("finding an existing key", () => {
  it("prefers the shell environment, like the SDK", async () => {
    await expect(
      findExistingKey("/repo", { CONFIDENT_API_KEY: KEY }, async () => ({})),
    ).resolves.toEqual({
      apiKey: KEY,
      source: "environment",
      inEnvLocal: false,
    });
    await expect(
      findExistingKey("/repo", { CONFIDENT_API_KEY: KEY }, async () => ({
        CONFIDENT_API_KEY: KEY,
      })),
    ).resolves.toMatchObject({ source: "environment", inEnvLocal: true });
  });

  it("falls back to .env.local", async () => {
    await expect(
      findExistingKey("/repo", {}, async () => ({ CONFIDENT_API_KEY: KEY })),
    ).resolves.toEqual({ apiKey: KEY, source: "env-local", inEnvLocal: true });
  });

  it("ignores blank values", async () => {
    await expect(
      findExistingKey("/repo", { CONFIDENT_API_KEY: " " }, async () => ({
        CONFIDENT_API_KEY: "",
      })),
    ).resolves.toBeUndefined();
  });
});

describe("checking a key", () => {
  it("lists one trace with the key header, and the project when given", async () => {
    const fetch = respond(200);
    await expect(
      checkKey(options.apiUrl, KEY, undefined, fetch),
    ).resolves.toEqual({ status: "accepted" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/v2/traces?pageSize=1",
      { headers: { CONFIDENT_API_KEY: KEY } },
    );

    await checkKey(options.apiUrl, KEY, "project-1", fetch);
    expect(fetch).toHaveBeenLastCalledWith(
      "https://api.example/v2/traces?pageSize=1",
      {
        headers: {
          CONFIDENT_API_KEY: KEY,
          "confident-project-id": "project-1",
        },
      },
    );
  });

  it("keeps a key behind the license gate, with a warning", async () => {
    const check = await checkKey(
      options.apiUrl,
      KEY,
      undefined,
      respond(403, { error: "Feature not enabled for this license" }),
    );
    expect(check).toMatchObject({ status: "accepted" });
    expect(check.status === "accepted" && check.warning).toContain(
      "Feature not enabled for this license",
    );
  });

  it("never echoes the key back", async () => {
    const check = await checkKey(
      options.apiUrl,
      KEY,
      undefined,
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(KEY)),
    );
    expect(JSON.stringify(check)).not.toContain(KEY);
  });

  it("derives the region endpoint from the key prefix", () => {
    expect(otelEndpointForKey("confident_eu_abc")).toBe(
      EU_OTEL_TRACES_ENDPOINT,
    );
    expect(otelEndpointForKey("confident_us_abc")).toBe(OTEL_TRACES_ENDPOINT);
    expect(otelEndpointForKey("legacy")).toBe(OTEL_TRACES_ENDPOINT);
  });
});

describe("resolving credentials", () => {
  it("signs in when the project has no key", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({ readEnvValues: async () => ({}) });
    await expect(resolveCredentials(options, signIn, deps)).resolves.toBe(
      newKey,
    );
    expect(deps.chooseReuse).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("reuses an accepted key without pairing or writing anything", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies();
    await expect(resolveCredentials(options, signIn, deps)).resolves.toEqual({
      apiKey: KEY,
      inEnvLocal: true,
      reused: true,
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(deps.chooseReuse).toHaveBeenCalledWith({
      source: "env-local",
      inEnvLocal: true,
    });
    const urls = vi.mocked(deps.fetch!).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(["https://api.example/v2/traces?pageSize=1"]);
    expect(urls.some((url) => url.includes("/cli/"))).toBe(false);
    for (const message of [
      ...deps.info.mock.calls.flat(),
      ...deps.warn.mock.calls.flat(),
    ]) {
      expect(String(message)).not.toContain(KEY);
    }
  });

  it("signs in when the user wants a new key", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({ chooseReuse: vi.fn(async () => false) });
    await expect(resolveCredentials(options, signIn, deps)).resolves.toBe(
      newKey,
    );
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("falls back to signing in when Confident AI rejects the key", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({
      fetch: respond(401, { error: "Invalid API key" }),
    });
    await expect(resolveCredentials(options, signIn, deps)).resolves.toBe(
      newKey,
    );
    expect(signIn).toHaveBeenCalledOnce();
    expect(deps.warn.mock.calls[0]![0]).toContain(
      "Confident AI rejected this key",
    );
  });

  it("signs in when the key belongs to another project than --proj-id", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({
      fetch: respond(400, {
        error:
          "The provided project id does not match this project-scoped API key.",
      }),
    });
    await expect(
      resolveCredentials({ ...options, projId: "project-2" }, signIn, deps),
    ).resolves.toBe(newKey);
    expect(signIn).toHaveBeenCalledOnce();
    expect(deps.warn.mock.calls[0]![0]).toContain("project-2");
  });

  it("does not trust a license refusal to confirm --proj-id", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({
      fetch: respond(403, { error: "Feature not enabled for this license" }),
    });
    await expect(
      resolveCredentials({ ...options, projId: "project-1" }, signIn, deps),
    ).resolves.toBe(newKey);
  });

  it("reuses a key that matches --proj-id", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies();
    await expect(
      resolveCredentials({ ...options, projId: "project-1" }, signIn, deps),
    ).resolves.toMatchObject({ apiKey: KEY, reused: true });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("checks and keeps an EU key against the EU API", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({
      readEnvValues: async () => ({ CONFIDENT_API_KEY: "confident_eu_key" }),
    });
    await expect(
      resolveCredentials(
        { ...options, apiUrl: "https://api.confident-ai.com" },
        signIn,
        deps,
      ),
    ).resolves.toMatchObject({
      reused: true,
      apiUrl: "https://eu.api.confident-ai.com",
    });
    expect(String(vi.mocked(deps.fetch).mock.calls[0]![0])).toBe(
      "https://eu.api.confident-ai.com/v2/traces?pageSize=1",
    );
  });

  it("leaves an explicit --api-url alone for an EU key", () => {
    expect(apiUrlForKey("https://api.example", "confident_eu_key")).toBe(
      "https://api.example",
    );
    expect(
      apiUrlForKey("https://api.confident-ai.com", "confident_us_key"),
    ).toBe("https://api.confident-ai.com");
  });

  it("signs in without offering reuse for --org-id alone", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies();
    await expect(
      resolveCredentials({ ...options, orgId: "org-1" }, signIn, deps),
    ).resolves.toBe(newKey);
    expect(deps.chooseReuse).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("signs in when the key cannot be checked", async () => {
    const signIn = vi.fn(async () => newKey);
    const deps = dependencies({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(new Error("fetch failed")),
    });
    await expect(resolveCredentials(options, signIn, deps)).resolves.toBe(
      newKey,
    );
    expect(deps.warn.mock.calls[0]![0]).toContain("Could not confirm this key");
  });
});

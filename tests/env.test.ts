import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureEnvLocalIgnored,
  mergeEnvContent,
  writeApiKey,
} from "../src/env.js";
import type { CommandRunner } from "../src/git.js";

const directories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "confident-env-test-"));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("environment merge", () => {
  it("preserves unrelated content and replaces duplicate keys once", () => {
    expect(
      mergeEnvContent(
        "OTHER=1\nexport CONFIDENT_API_KEY=old\nCONFIDENT_API_KEY=duplicate\n",
        "new value",
      ),
    ).toBe('OTHER=1\nCONFIDENT_API_KEY="new value"\n');
  });

  it("atomically writes a mode-0600 file", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, ".env.local"), "OTHER=1\n");
    await writeApiKey(directory, "secret");

    expect(await readFile(join(directory, ".env.local"), "utf8")).toContain(
      'CONFIDENT_API_KEY="secret"',
    );
    expect((await stat(join(directory, ".env.local"))).mode & 0o777).toBe(
      0o600,
    );
  });
});

describe("gitignore merge", () => {
  const runner: CommandRunner = vi.fn();

  it("appends .env.local with a safe newline", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, ".gitignore"), "dist/");
    await ensureEnvLocalIgnored(directory, runner, async () => false);
    expect(await readFile(join(directory, ".gitignore"), "utf8")).toBe(
      "dist/\n.env.local\n",
    );
  });

  it("does nothing when Git already ignores the file", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, ".gitignore"), "*.local\n");
    await expect(
      ensureEnvLocalIgnored(directory, runner, async () => true),
    ).resolves.toBe(false);
    expect(await readFile(join(directory, ".gitignore"), "utf8")).toBe(
      "*.local\n",
    );
  });
});

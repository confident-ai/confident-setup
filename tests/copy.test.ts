import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? filesUnder(join(directory, entry.name))
        : [join(directory, entry.name)],
    ),
  );
  return nested.flat();
};

/**
 * Setup is about tracing with confident-trace. The evaluation SDK has its own
 * setup now, so its name must not leak back into anything a user sees or an
 * agent reads: copy, prompts, comments, package metadata, or docs.
 */
describe("user-facing surface", () => {
  it("never names the evaluation SDK", async () => {
    const files = [
      ...(await filesUnder(join(root, "src"))),
      ...(await filesUnder(join(root, "prompts"))),
      join(root, "README.md"),
      join(root, "package.json"),
    ];
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (/deepeval/i.test(line)) {
          offenders.push(`${relative(root, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

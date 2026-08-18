import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import type { CommandRunner } from "./git.js";

const KEY = "CONFIDENT_API_KEY";

export const mergeEnvContent = (content: string, apiKey: string): string => {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content ? content.split(/\r?\n/) : [];
  const assignment = `${KEY}=${JSON.stringify(apiKey)}`;
  let replaced = false;
  const merged = lines.filter((line) => {
    if (!new RegExp(`^\\s*(?:export\\s+)?${KEY}\\s*=`).test(line)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  });

  if (replaced) {
    const index = merged.findIndex((line) =>
      new RegExp(`^\\s*(?:export\\s+)?${KEY}\\s*=`).test(line),
    );
    merged[index] = assignment;
  } else {
    if (merged.length > 0 && merged.at(-1) !== "") merged.push("");
    merged.push(assignment);
  }

  while (merged.at(-1) === "") merged.pop();
  return `${merged.join(newline)}${newline}`;
};

const readIfPresent = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

export const writeApiKey = async (
  cwd: string,
  apiKey: string,
): Promise<string> => {
  const path = join(cwd, ".env.local");
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error("Refusing to replace a symbolic-link .env.local file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const content = mergeEnvContent(await readIfPresent(path), apiKey);
  const temporaryPath = join(
    cwd,
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return path;
};

const defaultIgnoreCheck = async (
  cwd: string,
  runner: CommandRunner,
): Promise<boolean> => {
  try {
    await runner("git", ["check-ignore", "-q", ".env.local"], { cwd });
    return true;
  } catch {
    return false;
  }
};

export const ensureEnvLocalIgnored = async (
  cwd: string,
  runner: CommandRunner,
  ignoreCheck: (
    cwd: string,
    runner: CommandRunner,
  ) => Promise<boolean> = defaultIgnoreCheck,
): Promise<boolean> => {
  if (await ignoreCheck(cwd, runner)) return false;

  const path = join(cwd, ".gitignore");
  const content = await readIfPresent(path);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const next = `${content}${content && !content.endsWith("\n") ? newline : ""}.env.local${newline}`;
  await writeFile(path, next, { encoding: "utf8", mode: 0o644 });
  return true;
};

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

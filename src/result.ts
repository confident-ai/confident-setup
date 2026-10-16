import { readFile } from "node:fs/promises";

import { z } from "zod";

export const tracingSdks = [
  "confident-trace-python",
  "confident-trace-typescript",
  "opentelemetry",
] as const;

export const setupResultSchema = z
  .object({
    status: z.enum(["completed", "partial", "failed"]),
    changedFiles: z.array(z.string().min(1)),
    sdks: z.array(z.enum(tracingSdks)).max(tracingSdks.length),
    integrations: z.array(z.string().min(1)),
    runCommand: z.string(),
    runSucceeded: z.boolean(),
    needsFromUser: z.array(z.string().min(1)).optional(),
    errors: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "failed") {
      if (!result.errors?.length) {
        context.addIssue({
          code: "custom",
          path: ["errors"],
          message: "A failed setup must include at least one error.",
        });
      }
      return;
    }
    if (!result.sdks.length) {
      context.addIssue({
        code: "custom",
        path: ["sdks"],
        message: "Tracing setup must name at least one SDK it used.",
      });
    }
    if (!result.runCommand.trim()) {
      context.addIssue({
        code: "custom",
        path: ["runCommand"],
        message: "Tracing setup must include the command that runs the app.",
      });
    }
    /**
     * The trace check only means something after the app ran, so `completed`
     * is reserved for a run that happened, and `partial` has to say what the
     * user must supply before it can.
     */
    if (result.status === "completed" && !result.runSucceeded) {
      context.addIssue({
        code: "custom",
        path: ["runSucceeded"],
        message:
          "A completed setup must have run the app. Report partial when it could not run.",
      });
    }
    if (result.status === "partial") {
      if (result.runSucceeded) {
        context.addIssue({
          code: "custom",
          path: ["runSucceeded"],
          message:
            "A partial setup did not run the app. Report completed when it did.",
        });
      }
      if (!result.needsFromUser?.length) {
        context.addIssue({
          code: "custom",
          path: ["needsFromUser"],
          message:
            "A partial setup must say what the user needs to provide before the app can run.",
        });
      }
    }
  });

export type SetupResult = z.infer<typeof setupResultSchema>;

export const parseSetupResult = (value: unknown): SetupResult =>
  setupResultSchema.parse(value);

/**
 * A file the contract rejects was still written after the agent changed the
 * project, so the command it names may work and the files it lists are real.
 * Read those few fields apart from the contract so a reporting mistake never
 * hides how to run the app or what was changed.
 */
const salvageSchema = z
  .object({
    runCommand: z.string().min(1).optional(),
    changedFiles: z.array(z.string().min(1)).optional(),
  })
  // Unknown keys are dropped, so nothing else the agent wrote is carried along.
  .strip();

export type SalvagedResult = z.infer<typeof salvageSchema>;

export interface RejectedSetupResult {
  issues: string[];
  salvaged: SalvagedResult;
}

export type SetupResultOutcome =
  | { ok: true; result: SetupResult }
  | { ok: false; rejected: RejectedSetupResult };

const describeIssues = (error: unknown): string[] => {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
  }
  return [error instanceof Error ? error.message : String(error)];
};

/** Field by field, so one malformed field does not cost the others. */
const salvage = (value: unknown): SalvagedResult => {
  const parsed = salvageSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const runCommand = salvageSchema.shape.runCommand.safeParse(
    fields.runCommand,
  );
  const changedFiles = salvageSchema.shape.changedFiles.safeParse(
    fields.changedFiles,
  );
  return {
    ...(runCommand.success && runCommand.data
      ? { runCommand: runCommand.data }
      : {}),
    ...(changedFiles.success && changedFiles.data
      ? { changedFiles: changedFiles.data }
      : {}),
  };
};

export const readSetupResult = async (
  path: string,
): Promise<SetupResultOutcome> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      rejected: { issues: describeIssues(error), salvaged: {} },
    };
  }
  try {
    return { ok: true, result: parseSetupResult(value) };
  } catch (error) {
    return {
      ok: false,
      rejected: { issues: describeIssues(error), salvaged: salvage(value) },
    };
  }
};

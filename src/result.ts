import { readFile } from "node:fs/promises";

import { z } from "zod";

export const setupResultSchema = z
  .object({
    status: z.enum(["completed", "partial", "failed"]),
    changedFiles: z.array(z.string().min(1)),
    sdks: z.array(z.enum(["deepeval-python", "deepeval-typescript"])).min(1),
    levels: z.array(z.enum(["test-case", "span", "trace", "thread"])).min(1),
    datasetSource: z.string().min(1),
    metrics: z.array(z.string().min(1)).max(12),
    rerunCommand: z.string().min(1),
    testRunId: z.string().min(1).optional(),
    testRunUrl: z.string().url().optional(),
    errors: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "failed" && !result.errors?.length) {
      context.addIssue({
        code: "custom",
        path: ["errors"],
        message: "A failed setup must include at least one error.",
      });
    }
  });

export type SetupResult = z.infer<typeof setupResultSchema>;

export const parseSetupResult = (
  value: unknown,
  requireTestRun = true,
): SetupResult => {
  const result = setupResultSchema.parse(value);
  if (requireTestRun && result.status === "completed" && !result.testRunId) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["testRunId"],
        message: "A completed setup must include testRunId.",
      },
    ]);
  }
  return result;
};

export const readSetupResult = async (
  path: string,
  requireTestRun = true,
): Promise<SetupResult> => {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return parseSetupResult(value, requireTestRun);
};

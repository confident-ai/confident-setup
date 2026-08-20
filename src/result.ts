import { readFile } from "node:fs/promises";

import { z } from "zod";

export const setupResultSchema = z
  .object({
    status: z.enum(["completed", "partial", "failed"]),
    /**
     * Component-level is the shape the wizard asks for. `black-box` is the
     * fallback an application in neither SDK's language has to fall back to,
     * and it has no spans to report, so the two are validated apart.
     */
    shape: z.enum(["component-level", "black-box"]).default("component-level"),
    changedFiles: z.array(z.string().min(1)),
    sdks: z
      .array(z.enum(["deepeval-python", "deepeval-typescript"]))
      .min(1)
      .max(2),
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
    /**
     * Component metrics are the evaluation the wizard asks for, and a span is
     * where one can live, so a suite reporting none of them built something
     * else.
     */
    if (result.shape === "component-level" && !result.levels.includes("span")) {
      context.addIssue({
        code: "custom",
        path: ["levels"],
        message:
          "A component-level evaluation must report the span level. Report the black-box shape when the application has no SDK to instrument it with, or failed when no component metric could be attached.",
      });
    }
    /** Spans come from instrumentation, which is what black-box rules out. */
    if (result.shape === "black-box" && result.levels.includes("span")) {
      context.addIssue({
        code: "custom",
        path: ["levels"],
        message:
          "A black-box evaluation cannot report the span level. Report the component-level shape when the application was instrumented.",
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

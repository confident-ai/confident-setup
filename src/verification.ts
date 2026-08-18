import { z } from "zod";

export interface VerificationResult {
  testRunId: string;
  testRunUrl: string;
}

export const buildTestRunUrl = (
  appUrl: string,
  projectId: string,
  testRunId: string,
): string =>
  `${appUrl.replace(/\/+$/, "")}/project/${encodeURIComponent(projectId)}/test-runs/${encodeURIComponent(testRunId)}`;

export const verifyTestRun = async (
  apiUrl: string,
  appUrl: string,
  apiKey: string,
  projectId: string,
  testRunId: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<VerificationResult> => {
  const id = z.string().trim().min(1).parse(testRunId);
  const response = await fetchImplementation(
    `${apiUrl.replace(/\/+$/, "")}/v1/test-runs/${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Test run ${id} could not be verified (${response.status}).`,
    );
  }
  return {
    testRunId: id,
    testRunUrl: buildTestRunUrl(appUrl, projectId, id),
  };
};

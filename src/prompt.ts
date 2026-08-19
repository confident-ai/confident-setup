import canonicalPrompt from "../prompts/evaluation.md";
import { judgeVariables, type JudgeProvider } from "./judge.js";

export const getCanonicalPrompt = (): string => canonicalPrompt.trim();

/** Name the judge without ever naming its value. */
const describeJudge = (provider: JudgeProvider | undefined): string =>
  provider
    ? `- Judge model: ${provider.label}, already configured through ${judgeVariables(
        provider,
      ).join(
        ", ",
      )} in the project dotenv. Let DeepEval read it; never open or echo those values.`
    : "- Judge model: none configured. Use deterministic metrics only and do not add LLM-judge metrics.";

export const buildAgentPrompt = (
  projectDirectory: string,
  resultFile: string,
  paidModelRunConsent?: boolean,
  judge: { provider?: JudgeProvider } = {},
): string =>
  `${getCanonicalPrompt()}

Runtime context:
- Project directory: ${projectDirectory}
- Structured result destination: ${resultFile}
${describeJudge(judge.provider)}
${paidModelRunConsent === undefined ? "" : `- User consent for model-backed evaluation runs: ${paidModelRunConsent ? "granted" : "not granted"}\n`}

Work only in the project directory. The destination path is supplied for
clarity, but write it through CONFIDENT_SETUP_RESULT_FILE.`;

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

const describeCloud = (useConfidentAi: boolean): string =>
  useConfidentAi
    ? "- Cloud: Confident AI. CONFIDENT_API_KEY is already configured for DeepEval. A completed result requires testRunId from the uploaded run."
    : "- Cloud: local only. Do not upload to Confident AI or use CONFIDENT_API_KEY. Omit testRunId.";

export const buildAgentPrompt = (
  projectDirectory: string,
  resultFile: string,
  paidModelRunConsent?: boolean,
  judge: { provider?: JudgeProvider } = {},
  useConfidentAi = true,
): string =>
  `${getCanonicalPrompt()}

Runtime context:
- Project directory: ${projectDirectory}
- Structured result destination: ${resultFile}
${describeJudge(judge.provider)}
${describeCloud(useConfidentAi)}
${paidModelRunConsent === undefined ? "" : `- User consent for model-backed evaluation runs: ${paidModelRunConsent ? "granted" : "not granted"}\n`}

Work only in the project directory. The destination path is supplied for
clarity, but write it through CONFIDENT_SETUP_RESULT_FILE.`;

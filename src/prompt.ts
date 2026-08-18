import canonicalPrompt from "../prompts/evaluation.md";

export const getCanonicalPrompt = (): string => canonicalPrompt.trim();

export const buildAgentPrompt = (
  projectDirectory: string,
  resultFile: string,
): string =>
  `${getCanonicalPrompt()}

Runtime context:
- Project directory: ${projectDirectory}
- Structured result destination: ${resultFile}

Work only in the project directory. The destination path is supplied for
clarity, but write it through CONFIDENT_SETUP_RESULT_FILE.`;

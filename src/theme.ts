/**
 * Terminal colors taken from the confident-ai.com palette in
 * `app/styles/_theme.scss`, so the CLI reads as the same brand as the website.
 */

import pc from "picocolors";

/** Landing `--brand-violet: #760eff`. */
const BRAND_RGB = [118, 14, 255] as const;

const rgb =
  (red: number, green: number, blue: number) =>
  (text: string): string =>
    pc.isColorSupported
      ? `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`
      : text;

/**
 * The wizard's single accent. Steps, links, spinners, project names, and
 * success marks all use it, so nothing competes for attention except `alert`.
 */
export const brand = rgb(...BRAND_RGB);

/** Landing `--accent-label-ember: rgba(255, 65, 1, 1)`, for warnings and errors. */
export const alert = rgb(255, 65, 1);

/** Landing dark-theme `--text-secondary: #a9afba`, for supporting detail. */
export const muted = rgb(169, 175, 186);

/** pyfiglet `big_money-ne` "Confident AI", the DeepEval `deepeval login` banner. */
const WORDMARK_FULL = [
  "  /$$$$$$                       /$$$$$$  /$$       /$$                       /$$            /$$$$$$  /$$$$$$",
  " /$$__  $$                     /$$__  $$|__/      | $$                      | $$           /$$__  $$|_  $$_/",
  "| $$  \\__/  /$$$$$$  /$$$$$$$ | $$  \\__/ /$$  /$$$$$$$  /$$$$$$  /$$$$$$$  /$$$$$$        | $$  \\ $$  | $$",
  "| $$       /$$__  $$| $$__  $$| $$$$    | $$ /$$__  $$ /$$__  $$| $$__  $$|_  $$_/        | $$$$$$$$  | $$",
  "| $$      | $$  \\ $$| $$  \\ $$| $$_/    | $$| $$  | $$| $$$$$$$$| $$  \\ $$  | $$          | $$__  $$  | $$",
  "| $$    $$| $$  | $$| $$  | $$| $$      | $$| $$  | $$| $$_____/| $$  | $$  | $$ /$$      | $$  | $$  | $$",
  "|  $$$$$$/|  $$$$$$/| $$  | $$| $$      | $$|  $$$$$$$|  $$$$$$$| $$  | $$  |  $$$$/      | $$  | $$ /$$$$$$",
  " \\______/  \\______/ |__/  |__/|__/      |__/ \\_______/ \\_______/|__/  |__/   \\___/        |__/  |__/|______/",
] as const;

/** Same font, "Confident", for terminals too narrow for the full lockup. */
const WORDMARK_NAME = [
  "  /$$$$$$                       /$$$$$$  /$$       /$$                       /$$",
  " /$$__  $$                     /$$__  $$|__/      | $$                      | $$",
  "| $$  \\__/  /$$$$$$  /$$$$$$$ | $$  \\__/ /$$  /$$$$$$$  /$$$$$$  /$$$$$$$  /$$$$$$",
  "| $$       /$$__  $$| $$__  $$| $$$$    | $$ /$$__  $$ /$$__  $$| $$__  $$|_  $$_/",
  "| $$      | $$  \\ $$| $$  \\ $$| $$_/    | $$| $$  | $$| $$$$$$$$| $$  \\ $$  | $$",
  "| $$    $$| $$  | $$| $$  | $$| $$      | $$| $$  | $$| $$_____/| $$  | $$  | $$ /$$",
  "|  $$$$$$/|  $$$$$$/| $$  | $$| $$      | $$|  $$$$$$$|  $$$$$$$| $$  | $$  |  $$$$/",
  " \\______/  \\______/ |__/  |__/|__/      |__/ \\_______/ \\_______/|__/  |__/   \\___/",
] as const;

/** Same font, "AI", the narrowest mark that still reads as the money type. */
const WORDMARK_MARK = [
  "  /$$$$$$  /$$$$$$",
  " /$$__  $$|_  $$_/",
  "| $$  \\ $$  | $$",
  "| $$$$$$$$  | $$",
  "| $$__  $$  | $$",
  "| $$  | $$  | $$",
  "| $$  | $$ /$$$$$$",
  "|__/  |__/|______/",
] as const;

/** Widest art first; the banner picks the first tier the terminal can hold. */
const WORDMARK_TIERS = [
  { columns: 108, rows: WORDMARK_FULL },
  { columns: 84, rows: WORDMARK_NAME },
  { columns: 18, rows: WORDMARK_MARK },
] as const;

export const wizardSteps = {
  1: { title: "Sign in", short: "sign in" },
  2: { title: "Choose project", short: "project" },
  3: { title: "Save credentials", short: "credentials" },
  4: { title: "Set up the judge model", short: "judge model" },
  5: { title: "Choose how to add the evaluation", short: "method" },
  6: { title: "Run and verify the evaluation", short: "verify" },
} as const;

export type WizardStep = keyof typeof wizardSteps;

export const WIZARD_STEP_COUNT = Object.keys(wizardSteps).length;

export const stepRoadmap = (): string =>
  Object.values(wizardSteps)
    .map((step) => step.short)
    .join(" → ");

export const stepHeading = (current: WizardStep, detail?: string): string => {
  const title = detail ?? wizardSteps[current].title;
  return `${brand(`Step ${current} of ${WIZARD_STEP_COUNT}`)}  ${title}`;
};

/** DeepEval `render_login_message`, minus its login-specific wording. */
export const welcomeMessage = (): string =>
  `🥳 Welcome to ${brand("Confident AI")}, the evals cloud platform 🏡❤️`;

/** The `deepeval login` banner, stepped down to fit the terminal width. */
export const banner = (
  columns: number = process.stdout.columns ?? 80,
): string => {
  const tier = WORDMARK_TIERS.find((candidate) => columns >= candidate.columns);
  const wordmark = tier
    ? tier.rows.map((row) => brand(row))
    : [brand(pc.bold("CONFIDENT AI"))];
  return [welcomeMessage(), "", ...wordmark, "", muted(stepRoadmap())].join(
    "\n",
  );
};

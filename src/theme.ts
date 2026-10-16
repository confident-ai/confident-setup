/**
 * Terminal colors taken from the confident-ai.com palette in
 * `app/styles/_theme.scss`, so the CLI reads as the same brand as the website.
 */

import pc from "picocolors";

/** Landing `--brand-violet: #760eff`. */
const BRAND_RGB = [118, 14, 255] as const;

/** Accent cyan `#00e5ff`. */
const ACCENT_RGB = [0, 229, 255] as const;

const rgb =
  (red: number, green: number, blue: number) =>
  (text: string): string =>
    pc.isColorSupported
      ? `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`
      : text;

/** Reserved for the Confident AI name and wordmark. */
export const brand = rgb(...BRAND_RGB);

/**
 * Everything else the wizard highlights: steps, links, spinners, project names,
 * and success marks, so nothing competes for attention except `alert`.
 */
export const accent = rgb(...ACCENT_RGB);

/** Landing `--accent-label-ember: rgba(255, 65, 1, 1)`, for warnings and errors. */
export const alert = rgb(255, 65, 1);

/** Landing dark-theme `--text-secondary: #a9afba`, for supporting detail. */
export const muted = rgb(169, 175, 186);

/** pyfiglet `big_money-ne` "Confident AI" wordmark. */
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

interface WordmarkTier {
  columns: number;
  rows: readonly string[];
}

/** Widest art first; the banner picks the first tier the terminal can hold. */
const CONFIDENT_TIERS: readonly WordmarkTier[] = [
  { columns: 108, rows: WORDMARK_FULL },
  { columns: 84, rows: WORDMARK_NAME },
  { columns: 18, rows: WORDMARK_MARK },
];

export type WizardStepInfo = { title: string; short: string };

export const wizardSteps: Record<number, WizardStepInfo> = {
  1: { title: "Sign in", short: "sign in" },
  2: { title: "Choose project", short: "project" },
  3: { title: "Save credentials", short: "credentials" },
  4: { title: "Choose how to add tracing", short: "method" },
  5: {
    title: "Run your app and confirm the first trace",
    short: "first trace",
  },
};

export const WIZARD_STEP_COUNT = Object.keys(wizardSteps).length;

export const stepRoadmap = (
  steps: Record<number, WizardStepInfo> = wizardSteps,
): string =>
  Object.values(steps)
    .map((step) => step.short)
    .join(" → ");

export const stepHeading = (
  current: number,
  detail?: string,
  steps: Record<number, WizardStepInfo> = wizardSteps,
): string => {
  const title = detail ?? steps[current]?.title;
  if (!title) throw new Error(`Unknown wizard step: ${current}`);
  return `${accent(`Step ${current}/${Object.keys(steps).length}`)}  ${title}`;
};

export const welcomeMessage = (): string =>
  `Welcome to ${brand("Confident AI")} tracing setup.`;

/** The Confident AI wordmark, stepped down to fit the terminal width. */
export const banner = (
  columns: number = process.stdout.columns ?? 80,
): string => {
  const tier = CONFIDENT_TIERS.find(
    (candidate) => columns >= candidate.columns,
  );
  return [
    welcomeMessage(),
    "",
    ...(tier
      ? tier.rows.map((row) => brand(row))
      : [brand(pc.bold("CONFIDENT AI"))]),
    "",
    muted(stepRoadmap()),
  ].join("\n");
};

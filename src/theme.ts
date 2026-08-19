/**
 * Terminal colors taken from the confident-ai.com palette in
 * `app/styles/_theme.scss`, so the CLI reads as the same brand as the website.
 */

import pc from "picocolors";

/** Landing `--brand-violet: #760eff`. */
const BRAND_RGB = [118, 14, 255] as const;

/** Landing `--accent-label-pink: rgb(231, 0, 116)`. */
const PINK_RGB = [231, 0, 116] as const;

const rgb =
  (red: number, green: number, blue: number) =>
  (text: string): string =>
    pc.isColorSupported
      ? `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`
      : text;

export const brand = rgb(...BRAND_RGB);

/** Landing `--brand-violet-rgb: 110, 0, 255`, the deeper grid violet. */
export const accent = rgb(110, 0, 255);

/** Landing `--accent-label-blue: rgb(0, 157, 255)`. */
export const link = rgb(0, 157, 255);

/** Landing `--accent-label-teal: rgb(0, 255, 200)`. */
export const ok = rgb(0, 255, 200);

/** Landing dark-theme `--text-secondary: #a9afba`. */
export const muted = rgb(169, 175, 186);

/**
 * Fade brand violet into accent pink across `span` columns. Columns rather than
 * per-line length keeps the fade vertically aligned across banner rows.
 */
const gradient = (text: string, span: number): string => {
  if (!pc.isColorSupported) return text;
  const characters = [...text];
  const last = Math.max(span - 1, 1);
  const painted = characters.map((character, index) => {
    if (character === " ") return character;
    const ratio = Math.min(index / last, 1);
    const channel = (from: number, to: number): number =>
      Math.round(from + (to - from) * ratio);
    return `\x1b[38;2;${channel(BRAND_RGB[0], PINK_RGB[0])};${channel(
      BRAND_RGB[1],
      PINK_RGB[1],
    )};${channel(BRAND_RGB[2], PINK_RGB[2])}m${character}`;
  });
  return `${painted.join("")}\x1b[39m`;
};

/** pyfiglet `big_money-ne` "Confident AI", the DeepEval `deepeval login` banner. */
const WORDMARK_BIG = [
  "  /$$$$$$                       /$$$$$$  /$$       /$$                       /$$            /$$$$$$  /$$$$$$",
  " /$$__  $$                     /$$__  $$|__/      | $$                      | $$           /$$__  $$|_  $$_/",
  "| $$  \\__/  /$$$$$$  /$$$$$$$ | $$  \\__/ /$$  /$$$$$$$  /$$$$$$  /$$$$$$$  /$$$$$$        | $$  \\ $$  | $$",
  "| $$       /$$__  $$| $$__  $$| $$$$    | $$ /$$__  $$ /$$__  $$| $$__  $$|_  $$_/        | $$$$$$$$  | $$",
  "| $$      | $$  \\ $$| $$  \\ $$| $$_/    | $$| $$  | $$| $$$$$$$$| $$  \\ $$  | $$          | $$__  $$  | $$",
  "| $$    $$| $$  | $$| $$  | $$| $$      | $$| $$  | $$| $$_____/| $$  | $$  | $$ /$$      | $$  | $$  | $$",
  "|  $$$$$$/|  $$$$$$/| $$  | $$| $$      | $$|  $$$$$$$|  $$$$$$$| $$  | $$  |  $$$$/      | $$  | $$ /$$$$$$",
  " \\______/  \\______/ |__/  |__/|__/      |__/ \\_______/ \\_______/|__/  |__/   \\___/        |__/  |__/|______/",
] as const;

/** pyfiglet `small` "Confident AI", for terminals too narrow for the big art. */
const WORDMARK_SMALL = [
  "  ___           __ _    _         _       _   ___",
  " / __|___ _ _  / _(_)__| |___ _ _| |_    /_\\ |_ _|",
  "| (__/ _ \\ ' \\|  _| / _` / -_) ' \\  _|  / _ \\ | |",
  " \\___\\___/_||_|_| |_\\__,_\\___|_||_\\__| /_/ \\_\\___|",
] as const;

const BIG_WIDTH = 108;
const SMALL_WIDTH = 50;

export const wizardSteps = {
  1: { title: "Sign in", short: "sign in" },
  2: { title: "Choose project", short: "project" },
  3: { title: "Save credentials", short: "credentials" },
  4: { title: "Choose how to add the evaluation", short: "method" },
  5: { title: "Run and verify the evaluation", short: "verify" },
} as const;

export type WizardStep = keyof typeof wizardSteps;

export const WIZARD_STEP_COUNT = Object.keys(wizardSteps).length;

export const stepRoadmap = (): string =>
  Object.values(wizardSteps)
    .map((step) => step.short)
    .join(" → ");

export const stepHeading = (current: WizardStep, detail?: string): string => {
  const title = detail ?? wizardSteps[current].title;
  return `${brand("●")} ${accent(`Step ${current} of ${WIZARD_STEP_COUNT}`)}  ${title}`;
};

/** DeepEval `render_login_message`, minus its login-specific wording. */
export const welcomeMessage = (): string =>
  `🥳 Welcome to ${brand("Confident AI")}, the evals cloud platform 🏡❤️`;

/** The `deepeval login` banner, stepped down to fit the terminal width. */
export const banner = (
  columns: number = process.stdout.columns ?? 80,
): string => {
  const wordmark =
    columns >= BIG_WIDTH
      ? WORDMARK_BIG.map((row) => gradient(row, BIG_WIDTH))
      : columns >= SMALL_WIDTH
        ? WORDMARK_SMALL.map((row) => gradient(row, SMALL_WIDTH))
        : [brand(pc.bold("CONFIDENT AI"))];
  return [welcomeMessage(), "", ...wordmark, "", muted(stepRoadmap())].join(
    "\n",
  );
};

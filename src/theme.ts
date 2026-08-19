/** Terminal colors aligned with DeepEval's Confident AI CLI (Rich rgb/hex). */

import pc from "picocolors";

const rgb =
  (red: number, green: number, blue: number) =>
  (text: string): string =>
    pc.isColorSupported
      ? `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`
      : text;

/** DeepEval `render_login_message`: `[rgb(106,0,255)]Confident AI`. */
export const brand = rgb(106, 0, 255);

/** DeepEval progress elapsed `#5703ff`. */
export const accent = rgb(87, 3, 255);

/** DeepEval progress percentage `#00e5ff`. */
export const link = rgb(0, 229, 255);

/** DeepEval progress bar complete `#11ff00`. */
export const ok = rgb(17, 255, 0);

export const wizardStepTitle = {
  1: "Sign in",
  2: "Choose project",
  3: "Save credentials",
  4: "Choose how to add the evaluation",
  5: "Run and verify the evaluation",
} as const;

export type WizardStep = keyof typeof wizardStepTitle;

export const WIZARD_STEP_COUNT = Object.keys(wizardStepTitle).length;

export const remainingStepsLabel = (current: WizardStep): string => {
  const remaining = WIZARD_STEP_COUNT - current;
  if (remaining <= 0) return "last step";
  if (remaining === 1) return "1 step left";
  return `${remaining} steps left`;
};

export const stepHeading = (current: WizardStep, detail?: string): string => {
  const title = detail ?? wizardStepTitle[current];
  return `${brand("●")} ${accent(`Step ${current} of ${WIZARD_STEP_COUNT}`)}  ${title}  ${brand(`(${remainingStepsLabel(current)})`)}`;
};

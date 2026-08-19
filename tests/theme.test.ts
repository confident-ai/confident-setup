import { describe, expect, it } from "vitest";

import {
  remainingStepsLabel,
  stepHeading,
  WIZARD_STEP_COUNT,
} from "../src/theme.js";

describe("wizard steps", () => {
  it("reports remaining steps without eating Clack's dotted timeline", () => {
    expect(WIZARD_STEP_COUNT).toBe(5);
    expect(remainingStepsLabel(1)).toBe("4 steps left");
    expect(remainingStepsLabel(4)).toBe("1 step left");
    expect(remainingStepsLabel(5)).toBe("last step");
    expect(stepHeading(2)).toContain("Step 2 of 5");
    expect(stepHeading(2)).toContain("Choose project");
    expect(stepHeading(2)).toContain("3 steps left");
  });
});

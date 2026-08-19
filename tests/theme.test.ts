import { describe, expect, it } from "vitest";

import {
  banner,
  stepHeading,
  stepRoadmap,
  WIZARD_STEP_COUNT,
} from "../src/theme.js";

describe("welcome banner", () => {
  it("draws DeepEval's big_money-ne wordmark when it fits", () => {
    const rows = banner(120).split("\n");
    expect(rows[0]).toContain("the evals cloud platform");
    expect(rows).toContain(
      "  /$$$$$$                       /$$$$$$  /$$       /$$                       /$$            /$$$$$$  /$$$$$$",
    );
    expect(banner(120)).toContain("sign in → project");
  });

  it("steps down to smaller art rather than wrapping mid-word", () => {
    const medium = banner(80);
    expect(medium).not.toContain("/$$$$$$");
    expect(medium).toContain(
      "  ___           __ _    _         _       _   ___",
    );
    expect(banner(30)).toContain("CONFIDENT AI");
  });

  it("names every step in the roadmap", () => {
    expect(stepRoadmap().split(" → ")).toHaveLength(WIZARD_STEP_COUNT);
  });
});

describe("wizard steps", () => {
  it("labels position and title without repeating what remains", () => {
    expect(WIZARD_STEP_COUNT).toBe(5);
    expect(stepHeading(2)).toContain("Step 2 of 5");
    expect(stepHeading(2)).toContain("Choose project");
    expect(stepHeading(2)).not.toContain("left");
  });

  it("accepts a title that depends on the chosen setup mode", () => {
    expect(stepHeading(5, "Launch the detected agent")).toContain(
      "Step 5 of 5  Launch the detected agent",
    );
  });
});

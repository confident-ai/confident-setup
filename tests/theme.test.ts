import { describe, expect, it } from "vitest";

import {
  banner,
  stepHeading,
  stepRoadmap,
  welcomeMessage,
  WIZARD_STEP_COUNT,
} from "../src/theme.js";

/** Built at runtime because a literal escape trips `no-control-regex`. */
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g");

describe("welcome banner", () => {
  it("draws the Confident AI big_money-ne wordmark when it fits", () => {
    const rows = banner(120).split("\n");
    expect(rows[0]).toContain("Welcome to Confident AI tracing setup.");
    expect(rows).toContain(
      "  /$$$$$$                       /$$$$$$  /$$       /$$                       /$$            /$$$$$$  /$$$$$$",
    );
    expect(banner(120)).toContain(
      "sign in → project → credentials → method → first trace",
    );
  });

  it("keeps the money type at narrower widths instead of another font", () => {
    for (const columns of [108, 84, 60, 18]) {
      const art = banner(columns)
        .split("\n")
        .map((row) => row.replaceAll(ansiPattern, ""))
        .filter((row) => row.includes("$"));
      expect(art.length).toBeGreaterThan(0);
      expect(art.every((row) => row.length <= columns)).toBe(true);
    }
    expect(banner(17)).toContain("CONFIDENT AI");
  });

  it("names every step in the roadmap", () => {
    expect(stepRoadmap().split(" → ")).toHaveLength(WIZARD_STEP_COUNT);
  });

  it("uses plain words, without emoji", () => {
    expect(welcomeMessage()).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(banner(120)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("wizard steps", () => {
  it("labels position and title without repeating what remains", () => {
    expect(WIZARD_STEP_COUNT).toBe(5);
    expect(stepHeading(2)).toContain("Step 2/5");
    expect(stepHeading(2)).toContain("Choose project");
    expect(stepHeading(2)).not.toContain("left");
  });

  it("ends with adding tracing and confirming the first trace", () => {
    expect(stepHeading(4)).toContain("Step 4/5  Choose how to add tracing");
    expect(stepHeading(5)).toContain(
      "Step 5/5  Run your app and confirm the first trace",
    );
  });

  it("accepts a title that depends on the chosen setup mode", () => {
    expect(stepHeading(5, "Launch the detected agent")).toContain(
      "Step 5/5  Launch the detected agent",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  deferredSetupMessage,
  fullPermissionWarning,
  MANUAL_QUICKSTART_URL,
  setupModeOptions,
} from "../src/modes.js";
import {
  applyCustomSelection,
  enforceExclusiveSelection,
  selectProject,
  validateOrganization,
} from "../src/onboarding.js";
import { pairingUrlForApp } from "../src/wizard.js";

const onboarding = {
  state: "existing_user" as const,
  user: { email: "dev@example.com", name: "Dev" },
  organization: { id: "org-1", name: "Org" },
  projects: [
    { id: "allowed", name: "Allowed", canCreateApiKey: true },
    { id: "denied", name: "Denied", canCreateApiKey: false },
  ],
};

describe("mode helpers", () => {
  it("defines all three setup modes", () => {
    expect(setupModeOptions.map((option) => option.value)).toEqual([
      "built-in",
      "own-agent",
      "manual",
    ]);
    expect(fullPermissionWarning("Codex")).toContain("full permission");
    expect(deferredSetupMessage("manual")).toContain(MANUAL_QUICKSTART_URL);
  });

  it("moves pairing paths to the configured app origin", () => {
    expect(
      pairingUrlForApp(
        "https://self-hosted.example/base",
        "https://default.example/auth/cli?code=ABCD&region=US",
      ),
    ).toBe("https://self-hosted.example/auth/cli?code=ABCD&region=US");
  });
});

describe("onboarding mode helpers", () => {
  it("validates organization and project access", () => {
    expect(() => validateOrganization(onboarding, "org-1")).not.toThrow();
    expect(() => validateOrganization(onboarding, "other")).toThrow();
    expect(selectProject(onboarding, "allowed")).toEqual({
      id: "allowed",
      name: "Allowed",
    });
    expect(() => selectProject(onboarding, "denied")).toThrow("permission");
  });

  it("handles custom and exclusive questionnaire answers", () => {
    expect(applyCustomSelection(["A", "CUSTOM"], "CUSTOM", "Other")).toEqual([
      "A",
      "Other",
    ]);
    expect(enforceExclusiveSelection(["TOOLS", "NONE"], ["NONE"])).toEqual([
      "NONE",
    ]);
  });
});

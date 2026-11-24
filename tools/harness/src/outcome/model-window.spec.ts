// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { describe, expect, it } from "vitest";
import { IdeaError } from "../idea/index.js";
import { parseOutcome } from "./model.js";

const window = {
  kind: "verification",
  source: "platform-window",
  result: "confirmed",
  evidence: "activation window 2026-11-23T10:00Z to 11:00Z",
  summary: "Every evidence signal held for the whole window.",
};

describe("parseOutcome refuses a platform-window outcome", () => {
  it("refuses one written for a platform flag, naming the platform as its only writer", () => {
    expect(() =>
      parseOutcome({
        ...window,
        flag: "automatic-revert",
        environment: "local",
      }),
    ).toThrow(
      new IdeaError(
        "--source platform-window is written by the platform's activation window for an app flag, never by harness outcome record; a platform flag takes a live-run or an owner-waiver.",
      ),
    );
  });

  it("refuses one with no flag, so no idea can carry a window", () => {
    expect(() => parseOutcome(window)).toThrow(
      "--source platform-window is written by the platform's activation window",
    );
  });
});

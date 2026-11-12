import { describe, expect, it } from "vitest";
import { displayName, modelOnScreen } from "./models.js";

describe("modelOnScreen", () => {
  it("verifies the requested model's display name", () => {
    expect(modelOnScreen("claude-opus-5-5", "x Opus 5.5 · Max")).toEqual({
      status: "verified",
    });
  });

  it("reports another known model as a mismatch naming it", () => {
    expect(modelOnScreen("claude-opus-5-5", "Haiku 5.5")).toEqual({
      status: "mismatch",
      seen: "Haiku 5.5",
    });
  });

  it("does not match a longer version of the name", () => {
    expect(modelOnScreen("claude-sonnet-5-5", "Sonnet 5.55")).toEqual({
      status: "none",
    });
  });

  it("finds nothing for an unknown model ID or a blank screen", () => {
    expect(modelOnScreen("claude-future-9", "")).toEqual({ status: "none" });
    expect(displayName("claude-future-9")).toBeUndefined();
    expect(displayName("constructor")).toBeUndefined();
  });
});

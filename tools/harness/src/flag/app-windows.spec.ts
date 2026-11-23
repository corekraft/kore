// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { describe, expect, it } from "vitest";
import { NO_SOURCES, UNRECORDED_WINDOWS } from "./app-windows.js";

describe("UNRECORDED_WINDOWS", () => {
  it("holds no window for any app flag, so no file is read as proof", async () => {
    expect(
      await UNRECORDED_WINDOWS.list("leads.new-checkout", "local"),
    ).toEqual([]);
  });
});

describe("NO_SOURCES", () => {
  it("names no flag an app flag, so no platform window counts when no sources are given", () => {
    expect(NO_SOURCES.isAppFlag("leads.new-checkout")).toBe(false);
  });

  it("reads no window from the store it holds", async () => {
    expect(
      await NO_SOURCES.windows.list("leads.new-checkout", "local"),
    ).toEqual([]);
  });
});

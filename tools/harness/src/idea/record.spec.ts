import { describe, expect, it } from "vitest";
import { IdeaError, withOutcome } from "./record.js";

const IDEA = [
  "---",
  "title: Cache the probe results",
  "date: 2026-11-01",
  "---",
  "",
  "# Idea 0001: Cache the probe results",
  "",
  "Probes repeat work.",
  "",
].join("\n");

describe("withOutcome", () => {
  it("adds the outcome line inside the frontmatter and appends the section, touching nothing else", () => {
    expect(withOutcome(IDEA, "confirmed", "## Outcome\n\nBODY")).toBe(
      [
        "---",
        "title: Cache the probe results",
        "date: 2026-11-01",
        "outcome: confirmed",
        "---",
        "",
        "# Idea 0001: Cache the probe results",
        "",
        "Probes repeat work.",
        "",
        "## Outcome",
        "",
        "BODY",
        "",
      ].join("\n"),
    );
  });

  it("trims the section's surrounding whitespace before appending it", () => {
    expect(withOutcome(IDEA, "refuted", "\n\n## Outcome\n\nBODY\n\n")).toBe(
      withOutcome(IDEA, "refuted", "## Outcome\n\nBODY"),
    );
  });

  it.each([
    ["has no frontmatter", "# Idea 0001\n\nBody.\n"],
    ["never closes its frontmatter", "---\ntitle: x\n\nBody.\n"],
  ])("refuses an idea that %s, before it changes the text", (_case, text) => {
    expect(() => withOutcome(text, "confirmed", "## Outcome")).toThrow(
      new IdeaError("The idea has no frontmatter to record the outcome in."),
    );
  });
});

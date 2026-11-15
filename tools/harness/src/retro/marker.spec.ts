// Moving the `Last retrospective:` marker in a plan's text.
import { describe, expect, it } from "vitest";
import { MARKER_HEADING, withMarker } from "./marker.js";

const STAMP = "2026-01-02T03:04:05Z";

describe("withMarker", () => {
  it("appends a marker section to a plan that has none, leaving the rest as it was", () => {
    expect(withMarker("# Plan\n\ntext\n", STAMP)).toBe(
      `# Plan\n\ntext\n\n${MARKER_HEADING}\n\nLast retrospective: ${STAMP}\n`,
    );
  });

  it("rewrites only the marker line of an existing section", () => {
    const before = `# Plan\n\nLast retrospective: 2026-01-01\n\n${MARKER_HEADING}\n\nLast retrospective: 2025-12-31\n\ntail\n`;
    expect(withMarker(before, STAMP)).toBe(
      `# Plan\n\nLast retrospective: 2026-01-01\n\n${MARKER_HEADING}\n\nLast retrospective: ${STAMP}\n\ntail\n`,
    );
  });

  it("is a no-op when the section already holds the stamp", () => {
    const text = withMarker("x\n", STAMP);
    expect(withMarker(text, STAMP)).toBe(text);
  });
});

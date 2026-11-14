import { describe, expect, it } from "vitest";
import { parseDeclaration, PATTERNS } from "./declaration.js";

const body = (...lines: string[]) => lines.join("\n");

describe("parseDeclaration", () => {
  it("accepts each of the five patterns and reads the linked idea", () => {
    for (const pattern of PATTERNS) {
      expect(
        parseDeclaration(
          body("## Safety", `Safety pattern: ${pattern}`, "Idea: #193"),
        ),
      ).toEqual({ ok: true, pattern, idea: "#193" });
    }
    expect(PATTERNS).toEqual([
      "no-behaviour-change",
      "feature-flagged",
      "dark-launched",
      "branch-by-abstraction",
      "expand-contract",
    ]);
  });

  it("fails a body with no declaration, naming the field to add", () => {
    const result = parseDeclaration("Closes #1");
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("Safety pattern:");
  });

  it("fails a duplicate declaration even when both name the same pattern", () => {
    const result = parseDeclaration(
      body(
        "Safety pattern: feature-flagged",
        "Safety pattern: feature-flagged",
      ),
    );
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("exactly one");
  });

  it("fails an unknown pattern and lists the valid ones", () => {
    const result = parseDeclaration("Safety pattern: yolo");
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("expand-contract");
  });

  it("ignores the template's options listed inside an HTML comment", () => {
    const template = body(
      "Safety pattern: dark-launched",
      "<!-- Safety pattern: one of no-behaviour-change, feature-flagged -->",
    );
    expect(parseDeclaration(template)).toMatchObject({
      ok: true,
      pattern: "dark-launched",
    });
  });

  it("fails a field left blank", () => {
    expect(parseDeclaration("Safety pattern:   ")).toMatchObject({ ok: false });
  });

  it("reports no idea when the field is absent", () => {
    expect(parseDeclaration("Safety pattern: no-behaviour-change")).toEqual({
      ok: true,
      pattern: "no-behaviour-change",
      idea: undefined,
    });
  });

  it("reads a backticked pattern, and a blank idea as no idea", () => {
    expect(
      parseDeclaration("Safety pattern: `feature-flagged`\nIdea:   "),
    ).toEqual({ ok: true, pattern: "feature-flagged", idea: undefined });
  });
});

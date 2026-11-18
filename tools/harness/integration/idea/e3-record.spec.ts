// Idea E3 (no polling session) is filed as an idea record the retro tooling can read, with its guards and rules in the body and no window opened (#1049).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanTree, messages } from "../../src/testing/index.js";

const PATH = "docs/ideas/0038-e3-no-polling-session.md";
const TEXT = readFileSync(
  new URL(`../../../../${PATH}`, import.meta.url),
  "utf8",
);
const [, front = "", rawBody = ""] = TEXT.split(/^---\n/m);
/** The body with each wrapped line joined, so a phrase is found wherever it wraps. */
const body = rawBody.replace(/\s+/g, " ");
const fields = new Map(
  front
    .split("\n")
    .filter((line) => line.includes(": "))
    .map((line) => {
      const at = line.indexOf(": ");
      return [line.slice(0, at), line.slice(at + 2)] as const;
    }),
);

describe("the E3 idea record", () => {
  it("names the metric, direction, window and safety pattern the retro tooling reads", () => {
    expect(fields.get("kind")).toBe("harness");
    expect(fields.get("hypothesis-metric")).toBe("writerCost.current");
    expect(fields.get("hypothesis-direction")).toBe("down");
    expect(fields.get("hypothesis-window")).toBe("14d");
    expect(fields.get("safety-pattern")).toBe("no-behaviour-change");
  });

  it("passes kb-check as an idea record", () => {
    const problems = messages(
      cleanTree({ [PATH]: TEXT, "docs/ideas/0001-a.md": null }),
    ).filter((message) => message.startsWith("docs/ideas/"));
    expect(problems).toEqual([]);
  });

  it("lists the six guards", () => {
    for (const guard of [
      "share of one week's ceiling per merged change (must not rise)",
      "send-backs per merged change",
      "stalled panes",
      "owner overturns of advisor decisions",
      "main-session follow-ups per writer session",
      "handover count",
    ]) {
      expect(body).toContain(guard);
    }
  });

  it("states the margin, breach, insufficient-data and sequencing rules", () => {
    for (const rule of [
      "fixed from the control window before the arm opens",
      "A guard breach stops the arm",
      "A guard with too little data is insufficient",
      "E3 runs after the control window",
      "never overlaps the writer-tier window",
      "The owner opens the window",
      "E2 (early compaction) and E1 (Haiku under the cap) are filed after E3's recorded outcome",
    ]) {
      expect(body).toContain(rule);
    }
  });

  it("names the glossary terms and the tools it relies on", () => {
    for (const name of [
      "Main-session cost",
      "Compaction cap",
      "Handover",
      "Weekly token ceiling",
      "Share of one week's ceiling",
      "harness wait --idea",
      "harness session notify",
      "harness session prompt-size",
    ]) {
      expect(body).toContain(name);
    }
  });

  it("sets no ceiling value and calls no command that opens a window", () => {
    const ceilingLines = rawBody
      .split("\n")
      .filter((line) => /ceiling/i.test(line));
    expect(ceilingLines.filter((line) => /\d{3,}/.test(line))).toEqual([]);
    expect(TEXT).not.toMatch(/window open|KORE_WRITER_EXPERIMENT_START=/);
  });
});

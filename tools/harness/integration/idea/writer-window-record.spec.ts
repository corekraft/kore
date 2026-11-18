// The randomized writer-tier window is filed as an idea record the retro tooling can read, with its metric, guards, reversal placeholders and the owner's open items in the body, and no window opened (#1013).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flowMetricNames } from "../../src/flow/index.js";
import { cleanTree, messages } from "../../src/testing/index.js";

const PATH = "docs/ideas/0040-writer-tier-window.md";
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

describe("the writer-tier window idea record", () => {
  it("names the metric, direction, window and safety pattern the retro tooling reads", () => {
    expect(fields.get("kind")).toBe("harness");
    expect(fields.get("hypothesis-metric")).toBe("writerArms.overall");
    expect(fields.get("hypothesis-direction")).toBe("down");
    expect(fields.get("hypothesis-window")).toBe("14d");
    expect(fields.get("safety-pattern")).toBe("no-behaviour-change");
  });

  it("names a metric the flow report has, so the qualifier can read it", () => {
    expect(flowMetricNames()).toContain(fields.get("hypothesis-metric"));
  });

  it("passes kb-check as an idea record", () => {
    const problems = messages(
      cleanTree({ [PATH]: TEXT, "docs/ideas/0001-a.md": null }),
    ).filter((message) => message.startsWith("docs/ideas/"));
    expect(problems).toEqual([]);
  });

  it("cites the closed #825 and the specs it follows", () => {
    for (const reference of ["#825", "#994", "#998", "#1013"]) {
      expect(body).toContain(reference);
    }
  });

  it("states the primary, its direction and its window", () => {
    for (const phrase of [
      "all-in cost per merged change by first-launch tier",
      "Haiku lower by the margin the owner records",
      "14 days or longer",
    ]) {
      expect(body).toContain(phrase);
    }
  });

  it("lists the three guards", () => {
    for (const guard of [
      "blocked share",
      "send-backs per merged change",
      "owner minutes per merged change",
    ]) {
      expect(body).toContain(guard);
    }
  });

  it("records the reversal conditions as placeholders, with owner minutes as the tie-break", () => {
    for (const phrase of [
      "Sonnet becomes the default for a ticket class only if",
      "Haiku's all-in cost per merged change is not lower by the margin",
      "its blocked share or send-backs per merged change are worse by a margin",
      "owner minutes per merged change break a tie",
    ]) {
      expect(body).toContain(phrase);
    }
  });

  it("reads the Reviewer measurement split by tier and merges no prompt-size mechanism inside the window", () => {
    expect(body).toContain(
      "The Reviewer measurement (#817) is read split by writer tier",
    );
    expect(body).toContain("No prompt-size mechanism merges inside the window");
  });

  it("lists the owner's open items", () => {
    for (const item of [
      "the margin",
      "the share",
      "the length",
      "the stratifier",
      "opening the window",
      "the extra spend estimate",
    ]) {
      expect(body).toContain(item);
    }
  });

  it("states that the default writer tier changes only by an owner decision after the result", () => {
    expect(body).toContain(
      "The default writer tier changes only by an owner decision after the result",
    );
  });

  it("sets no margin, share or length value and opens no window", () => {
    const valueLines = rawBody
      .split("\n")
      .filter((line) => /margin|share|stratifier/i.test(line));
    expect(valueLines.filter((line) => /\d+ ?%|percent/.test(line))).toEqual(
      [],
    );
    expect(TEXT).not.toMatch(/KORE_WRITER_EXPERIMENT_START=/);
    expect(TEXT).not.toMatch(/harness flag activate/);
  });
});

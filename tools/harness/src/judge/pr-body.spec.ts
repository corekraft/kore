import { describe, expect, it } from "vitest";
import { JudgeError } from "./errors.js";
import { renderPrBody } from "./pr-body.js";

const base = { body: "Summary of the change.", pattern: "no-behaviour-change" };

describe("renderPrBody writes the declaration lines the precheck reads", () => {
  it("ends the body with the safety pattern line, after the summary", () => {
    expect(renderPrBody(base).body).toBe(
      "Summary of the change.\n\nSafety pattern: no-behaviour-change\n",
    );
  });

  it("writes Refs for the linked issue by default, so a merge never closes an outcome issue", () => {
    const { body, warnings } = renderPrBody({ ...base, issue: 746 });
    expect(body).toContain("\nRefs #746\n");
    expect(body).not.toMatch(/Closes/);
    expect(warnings).toEqual([]);
  });

  it("writes Closes only when closes is asked for", () => {
    const { body } = renderPrBody({ ...base, issue: 746, closes: true });
    expect(body).toContain("\nCloses #746\n");
    expect(body).not.toMatch(/Refs/);
  });

  it("writes the idea line before the safety pattern line", () => {
    expect(renderPrBody({ ...base, idea: "123" }).body).toBe(
      "Summary of the change.\n\nIdea: 123\nSafety pattern: no-behaviour-change\n",
    );
  });

  it("writes the expand step of a contract before the safety pattern line", () => {
    expect(
      renderPrBody({ ...base, pattern: "expand-contract", expandStep: 700 })
        .body,
    ).toBe(
      "Summary of the change.\n\nExpand step: #700\nSafety pattern: expand-contract\n",
    );
  });

  it("omits the summary paragraph when the body is empty", () => {
    expect(renderPrBody({ ...base, body: "" }).body).toBe(
      "Safety pattern: no-behaviour-change\n",
    );
  });
});

describe("renderPrBody refuses what the precheck would refuse, before any PR exists", () => {
  it("refuses a contract that names no expand step, and says how to name one", () => {
    expect(() => renderPrBody({ ...base, pattern: "expand-contract" })).toThrow(
      /--expand-step/,
    );
  });

  it("refuses an expand step on a pattern that is not expand-contract", () => {
    expect(() => renderPrBody({ ...base, expandStep: 700 })).toThrow(
      /only to expand-contract/,
    );
  });

  it("refuses an unknown pattern and lists the valid ones", () => {
    expect(() => renderPrBody({ ...base, pattern: "yolo" })).toThrow(
      /yolo.*no-behaviour-change/,
    );
  });

  it("throws a JudgeError so the command reports it instead of crashing", () => {
    expect(() => renderPrBody({ ...base, pattern: "yolo" })).toThrow(
      JudgeError,
    );
  });
});

describe("renderPrBody warns, never refuses, when closes meets an idea", () => {
  it("warns citing ADR 0079 and still renders", () => {
    const { body, warnings } = renderPrBody({
      ...base,
      issue: 746,
      closes: true,
      idea: "123",
    });
    expect(body).toContain("Closes #746");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ADR 0079/);
  });

  it("does not warn for Refs with an idea", () => {
    expect(renderPrBody({ ...base, issue: 746, idea: "123" }).warnings).toEqual(
      [],
    );
  });
});

// Every body `harness pr open` renders must read back through the precheck's own
// declaration parser and audit with the pattern, idea and expand step it was given.
// Integration tier: the renderer and the parser run together, with no gh and no cluster
// (ADR 0098).

import { describe, expect, it } from "vitest";
import {
  PATTERNS,
  auditDeclaration,
  parseDeclaration,
  renderPrBody,
} from "../src/judge/index.js";

const SUMMARY =
  "Summary.\n\n- a bullet\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";

describe("a body pr open renders is accepted by the declaration parser", () => {
  it.each(PATTERNS.filter((pattern) => pattern !== "expand-contract"))(
    "reads back %s, with and without an idea and an issue",
    (pattern) => {
      for (const idea of [undefined, "123", "some-slug"]) {
        for (const closes of [false, true]) {
          const { body } = renderPrBody({
            body: SUMMARY,
            pattern,
            issue: 746,
            closes,
            ...(idea === undefined ? {} : { idea }),
          });
          expect(parseDeclaration(body)).toEqual({
            ok: true,
            pattern,
            idea,
            expandStep: undefined,
          });
          expect(auditDeclaration(body)).toEqual({ ok: true });
        }
      }
    },
  );

  it("reads back the expand step of a contract", () => {
    const { body } = renderPrBody({
      body: SUMMARY,
      pattern: "expand-contract",
      expandStep: 700,
      idea: "123",
    });
    expect(parseDeclaration(body)).toEqual({
      ok: true,
      pattern: "expand-contract",
      idea: "123",
      expandStep: 700,
    });
    expect(auditDeclaration(body)).toEqual({ ok: true });
  });

  it("reads back with an empty summary", () => {
    const { body } = renderPrBody({ body: "", pattern: "dark-launched" });
    expect(auditDeclaration(body)).toEqual({ ok: true });
  });

  it("is not confused by declaration-looking text in the summary's HTML comments", () => {
    const { body } = renderPrBody({
      body: "<!-- Safety pattern: feature-flagged -->\nText.",
      pattern: "no-behaviour-change",
    });
    expect(parseDeclaration(body)).toMatchObject({
      ok: true,
      pattern: "no-behaviour-change",
    });
  });
});

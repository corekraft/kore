import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  CANDIDATE,
  DELETION,
  body,
  checksRule,
  liveCandidate,
  liveMain,
  rulesetRepo,
  sent,
  sync,
} from "../../src/testing/index.js";

// The declared checks require check and scan; live main still requires only check.
const OLD = checksRule("check");
const NEW = checksRule("check", "scan");

describe("harness ruleset sync stages a changed rule in the candidate", () => {
  it("syncs a tightened rule into the candidate while main keeps its old parameters", async () => {
    const h = rulesetRepo({ main: liveMain([DELETION, OLD]) });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["POST", "new", body(CANDIDATE, "evaluate", [NEW])],
    ]);
  });

  it("reports the rule as pending in the dry run and the json, and changes main not at all", async () => {
    const h = rulesetRepo({ main: liveMain([DELETION, OLD]) });
    expect(await run([...sync("--dry-run"), "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      main: { action: "none", pending: ["required_status_checks"] },
      candidate: { action: "create", rules: ["required_status_checks"] },
    });
    const text = rulesetRepo({ main: liveMain([DELETION, OLD]) });
    await run(sync("--dry-run"), text.deps);
    expect(text.out()).toMatch(/pending: required_status_checks/);
  });

  it("updates a candidate that holds an older version of the changed rule", async () => {
    const h = rulesetRepo({
      main: liveMain([DELETION, OLD]),
      candidate: liveCandidate([checksRule("check", "other")]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([["PUT", "8", body(CANDIDATE, "evaluate", [NEW])]]);
  });

  it("promotes the changed rule once the candidate holds it: candidate first, then main", async () => {
    const h = rulesetRepo({
      main: liveMain([DELETION, OLD]),
      candidate: liveCandidate([NEW]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["PUT", "8", body(CANDIDATE, "evaluate", [])],
      ["PUT", "7", body("main", "active", [DELETION, NEW])],
    ]);
  });

  it("keeps a live rule in main when its mode is audit, and syncs the declared version into the candidate", async () => {
    const h = rulesetRepo({
      modes: { deletion: "audit" },
      main: liveMain([DELETION, NEW]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["POST", "new", body(CANDIDATE, "evaluate", [DELETION])],
    ]);
  });

  it("stages a rule main does not have yet instead of adding it as active", async () => {
    const h = rulesetRepo({ main: liveMain([DELETION]) });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["POST", "new", body(CANDIDATE, "evaluate", [NEW])],
    ]);
  });
});

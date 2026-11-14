import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  CANDIDATE,
  CHECKS,
  DELETION,
  body,
  liveCandidate,
  liveMain,
  mutations,
  rulesetRepo,
  sent,
  sync,
} from "../../src/testing/index.js";

describe("harness ruleset sync keeps main active", () => {
  it("leaves both rulesets alone when every rule enforces and main matches", async () => {
    const h = rulesetRepo({ main: liveMain() });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(mutations(h)).toEqual([]);
    expect(h.out()).toMatch(/no change/i);
  });

  it("syncs an audit rule into a candidate ruleset as evaluate, never into main", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["POST", "new", body(CANDIDATE, "evaluate", [CHECKS])],
    ]);
  });

  it("updates a candidate whose rules differ", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
      candidate: liveCandidate([]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["PUT", "8", body(CANDIDATE, "evaluate", [CHECKS])],
    ]);
  });

  it("sends active for main on every write, even when main was flipped to evaluate by hand", async () => {
    const h = rulesetRepo({
      main: liveMain(undefined, { enforcement: "evaluate" }),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["PUT", "7", body("main", "active", [DELETION, CHECKS])],
    ]);
  });

  it("never sends evaluate to main for any mix of modes", async () => {
    for (const modes of [
      { deletion: "audit", checks: "audit" },
      { checks: "audit" },
      {},
    ] as const) {
      const h = rulesetRepo({ modes, main: liveMain() });
      await run(sync("--confirm", "--allow-removal"), h.deps);
      const toMain = sent(h).filter(([, id]) => id === "7");
      expect(toMain.map(([, , b]) => b["enforcement"])).not.toContain(
        "evaluate",
      );
    }
  });
});

describe("harness ruleset sync promotion and first creation", () => {
  it("promotes an approved rule: the candidate shrinks first, then main gains it as active", async () => {
    const h = rulesetRepo({
      main: liveMain([DELETION]),
      candidate: liveCandidate([CHECKS]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["PUT", "8", body(CANDIDATE, "evaluate", [])],
      ["PUT", "7", body("main", "active", [DELETION, CHECKS])],
    ]);
  });

  it("creates main as active when GitHub has none", async () => {
    const h = rulesetRepo({});
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["POST", "new", body("main", "active", [DELETION, CHECKS])],
    ]);
  });

  it("names an inventory rule that is missing for a declared rule", async () => {
    const h = rulesetRepo({ main: liveMain() });
    h.set(".claude/guardrails.yaml", JSON.stringify({ guardrails: [] }));
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/main-ruleset-deletion/);
  });
});

describe("harness ruleset sync when GitHub refuses evaluate", () => {
  const refused = {
    match: (_c: string, a: readonly string[]) =>
      a.includes("-X") && a.at(-3)?.endsWith("/rulesets") === true,
    result: {
      code: 1,
      stderr: "HTTP 422: Enforcement 'evaluate' requires GitHub Enterprise",
    },
  };

  it("stops, says evaluate is unavailable on this plan, and changes nothing", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION, { type: "pull_request" }]),
      extra: [refused],
    });
    expect(await run(sync("--confirm", "--allow-removal"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/evaluate is unavailable on this plan/i);
    expect(h.err()).toMatch(/nothing was changed/i);
    // The candidate was tried first, so main was never written.
    expect(sent(h).map(([, id]) => id)).toEqual(["new"]);
  });

  it("reports an unrelated 422 as a plain failure, not as a missing plan feature", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
      extra: [
        {
          ...refused,
          result: { code: 1, stderr: "HTTP 422: Invalid property /rules/0" },
        },
      ],
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/Invalid property/);
    expect(h.err()).not.toMatch(/unavailable on this plan/);
  });

  it("fails with the gh error when main cannot be written", async () => {
    const h = rulesetRepo({
      main: liveMain(undefined, { enforcement: "evaluate" }),
      extra: [
        {
          match: (_c, a) => a.includes("PUT"),
          result: { code: 1, stderr: "HTTP 403 forbidden" },
        },
      ],
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toContain("HTTP 403");
  });
});

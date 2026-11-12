import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  CHECKS,
  DECLARED,
  DELETION,
  REPO,
  liveCandidate,
  liveMain,
  mutations,
  rulesetRepo,
  sync,
} from "../testing/ruleset-support.js";

describe("harness ruleset sync on unusual input", () => {
  it("names a declared ruleset that is not a JSON object with rules", async () => {
    const h = rulesetRepo({ main: liveMain() });
    h.set(DECLARED, '{"name": "main"}');
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(
      /must be a JSON object with a "name" and a "rules"/,
    );
  });

  it("refuses to update a live ruleset GitHub returned without a numeric id", async () => {
    const h = rulesetRepo({
      main: liveMain([DELETION], { id: "seven" }),
    });
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/without a numeric id/);
    expect(mutations(h)).toEqual([]);
  });

  it("refuses to update a live candidate GitHub returned without a numeric id", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
      candidate: { ...liveCandidate([CHECKS]), id: undefined, rules: [] },
    });
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/main-candidate without a numeric id/);
  });

  it("leaves a candidate alone when its rules, fields and enforcement already match", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
      candidate: liveCandidate([CHECKS]),
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(mutations(h)).toEqual([]);
  });

  it("does not create an empty candidate when every rule enforces", async () => {
    const h = rulesetRepo({ main: liveMain([DELETION]) });
    expect(await run([...sync("--dry-run"), "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out()).candidate).toMatchObject({ action: "none" });
  });

  it("rethrows a lock failure that is not a held lock", async () => {
    const h = rulesetRepo({ main: liveMain([DELETION]) });
    h.deps.fs.createFile = () =>
      Promise.reject(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    await expect(run(sync("--confirm"), h.deps)).rejects.toThrow("disk full");
    expect(mutations(h)).toEqual([]);
  });

  it("names the repository in a lock refusal", async () => {
    const h = rulesetRepo({ main: liveMain([DELETION]) });
    h.set(".kore/state/locks/ruleset-corekraft-kore.lock", "{}");
    await run(sync("--confirm"), h.deps);
    expect(h.err()).toContain(REPO);
  });
});

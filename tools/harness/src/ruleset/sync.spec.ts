import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  REPO,
  declared,
  live,
  mutations,
  rulesetRepo,
  sync,
} from "../testing/ruleset-support.js";

const put = (enforcement: string) => ({
  command: "gh",
  args: ["api", "-X", "PUT", `repos/${REPO}/rulesets/7`, "--input", "-"],
  input: JSON.stringify({ ...declared, enforcement }),
});

describe("harness ruleset sync", () => {
  it("syncs an audit rule as evaluate", async () => {
    const h = rulesetRepo("audit", live("active"));
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    const [call, ...rest] = mutations(h);
    expect(rest).toEqual([]);
    expect({
      command: call?.command,
      args: call?.args,
      input: call?.options?.input,
    }).toEqual(put("evaluate"));
  });

  it("syncs an enforce rule as active", async () => {
    const h = rulesetRepo("enforce", live("evaluate"));
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(
      JSON.parse(mutations(h)[0]?.options?.input ?? "{}").enforcement,
    ).toBe("active");
  });

  it("creates the ruleset in evaluate mode when GitHub has none and the rule is audit", async () => {
    const h = rulesetRepo("audit", undefined);
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    const [call] = mutations(h);
    expect(call?.args).toEqual([
      "api",
      "-X",
      "POST",
      `repos/${REPO}/rulesets`,
      "--input",
      "-",
    ]);
    expect(JSON.parse(call?.options?.input ?? "{}").enforcement).toBe(
      "evaluate",
    );
  });

  it("changes the rules and keeps the enforcement the mode names", async () => {
    const h = rulesetRepo("audit", live("evaluate", { rules: [] }));
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(JSON.parse(mutations(h)[0]?.options?.input ?? "{}")).toEqual({
      ...declared,
      enforcement: "evaluate",
    });
  });

  it("mutates nothing when live already matches, ignoring fields GitHub adds", async () => {
    const h = rulesetRepo("enforce", live("active"));
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(mutations(h)).toEqual([]);
    expect(h.out()).toMatch(/no change/i);
  });
});

describe("harness ruleset sync dry run and confirmation", () => {
  it("dry run shows the planned change and mutates nothing", async () => {
    const h = rulesetRepo("audit", live("active"));
    expect(await run(sync("--dry-run"), h.deps)).toBe(0);
    expect(mutations(h)).toEqual([]);
    expect(h.out()).toMatch(/active.*evaluate/);
    expect(h.out()).toMatch(/dry run/i);
  });

  it("dry run reports the plan as json", async () => {
    const h = rulesetRepo("audit", live("active"));
    expect(await run([...sync("--dry-run"), "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      action: "update",
      from: "active",
      enforcement: "evaluate",
      dryRun: true,
      repo: REPO,
      target: "main",
    });
  });

  it("refuses to change the live ruleset without --confirm and mutates nothing", async () => {
    const h = rulesetRepo("audit", live("active"));
    expect(await run(sync(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/--confirm/);
    expect(h.err()).toMatch(/operator/);
    expect(mutations(h)).toEqual([]);
  });
});

describe("harness ruleset sync refusals", () => {
  it.each([
    ["--repo", ["ruleset", "sync", "--target", "main", "--dry-run"]],
    ["--target", ["ruleset", "sync", "--repo", REPO, "--dry-run"]],
  ])("refuses a sync that omits %s", async (flag, args) => {
    const h = rulesetRepo("audit", live("active"));
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toContain(flag);
    expect(h.runner.calls).toEqual([]);
  });

  it("refuses a target the repository does not declare", async () => {
    const h = rulesetRepo("audit", live("active"));
    const args = [
      "ruleset",
      "sync",
      "--repo",
      REPO,
      "--target",
      "other",
      "--dry-run",
    ];
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toMatch(/declares.*main/);
    expect(h.runner.calls).toEqual([]);
  });

  it("fails with the gh error and does not report success when the read fails", async () => {
    const h = rulesetRepo("audit", live("active"), [
      {
        match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets`,
        result: { code: 1, stderr: "HTTP 404" },
      },
    ]);
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toContain("HTTP 404");
  });

  it("fails when GitHub rejects the update", async () => {
    const h = rulesetRepo("audit", live("active"), [
      {
        match: (_c, a) => a.includes("PUT"),
        result: { code: 1, stderr: "HTTP 422 evaluate requires Enterprise" },
      },
    ]);
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toContain("HTTP 422");
  });

  it("names the inventory when it has no main-ruleset rule", async () => {
    const h = rulesetRepo("audit", live("active"));
    h.set(".claude/guardrails.yaml", JSON.stringify({ guardrails: [] }));
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/main-ruleset/);
  });

  it("names the problem when GitHub does not return a ruleset list", async () => {
    const h = rulesetRepo("audit", live("active"), [
      {
        match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets`,
        result: { stdout: '{"message":"Not Found"}' },
      },
    ]);
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/did not return a list/);
  });

  it("writes only json to stderr when --json is set", async () => {
    const h = rulesetRepo("audit", live("active"));
    expect(await run([...sync(), "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err()).error).toMatch(/--confirm/);
  });
});

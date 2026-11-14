import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  CANDIDATE,
  CHECKS,
  DELETION,
  LOCK,
  REPO,
  liveCandidate,
  liveMain,
  mutations,
  rulesetRepo,
  sent,
  sync,
} from "../../src/testing/index.js";

const EXTRA = { type: "required_linear_history" };

describe("harness ruleset sync dry run and confirmation", () => {
  it("dry run shows the planned change for both rulesets and mutates nothing", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
    });
    expect(await run(sync("--dry-run"), h.deps)).toBe(0);
    expect(mutations(h)).toEqual([]);
    expect(h.out()).toMatch(/dry run/i);
    expect(h.out()).toMatch(new RegExp(`${CANDIDATE}.*create`, "i"));
    expect(h.out()).toMatch(/required_status_checks/);
  });

  it("dry run reports the plan as json", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
    });
    expect(await run([...sync("--dry-run"), "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      repo: REPO,
      target: "main",
      dryRun: true,
      main: { action: "none", added: [], removed: [] },
      candidate: {
        name: CANDIDATE,
        action: "create",
        rules: ["required_status_checks"],
      },
    });
  });

  it("refuses to change the live ruleset without --confirm and mutates nothing", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
    });
    expect(await run(sync(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/--confirm/);
    expect(h.err()).toMatch(/operator/);
    expect(mutations(h)).toEqual([]);
  });
});

describe("harness ruleset sync refuses unclear targets", () => {
  it.each([
    ["--repo", ["ruleset", "sync", "--target", "main", "--dry-run"]],
    ["--target", ["ruleset", "sync", "--repo", REPO, "--dry-run"]],
  ])("refuses a sync that omits %s", async (flag, args) => {
    const h = rulesetRepo({ main: liveMain() });
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toContain(flag);
    expect(h.runner.calls).toEqual([]);
  });

  it("refuses a target the repository does not declare", async () => {
    const h = rulesetRepo({ main: liveMain() });
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
    expect(h.err()).toMatch(/declares no ruleset "other"/);
    expect(h.runner.calls).toEqual([]);
  });

  it("refuses a declared ruleset whose name differs from --target, so a sync never renames main", async () => {
    const h = rulesetRepo({ main: liveMain() });
    h.set(
      ".github/rulesets/main.json",
      JSON.stringify({ name: "renamed", rules: [] }),
    );
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/names the ruleset "renamed".*--target is main/);
    expect(h.err()).toMatch(/rename/i);
    expect(h.runner.calls).toEqual([]);
  });

  it("writes only json to stderr when --json is set", async () => {
    const h = rulesetRepo({
      modes: { checks: "audit" },
      main: liveMain([DELETION]),
    });
    expect(await run([...sync(), "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err()).error).toMatch(/--confirm/);
  });
});

describe("harness ruleset sync never silently removes a live rule", () => {
  const scene = { main: liveMain([DELETION, CHECKS, EXTRA]) };

  it("names the rule live has and the file lacks in the dry run and the json", async () => {
    const h = rulesetRepo(scene);
    expect(await run(sync("--dry-run"), h.deps)).toBe(0);
    expect(h.out()).toMatch(/removed: required_linear_history/);
    expect(h.out()).toMatch(/--allow-removal/);
    const j = rulesetRepo(scene);
    await run([...sync("--dry-run"), "--json"], j.deps);
    expect(JSON.parse(j.out()).main).toMatchObject({
      removed: ["required_linear_history"],
      added: [],
    });
    expect(mutations(h).concat(mutations(j))).toEqual([]);
  });

  it("refuses the removal without --allow-removal, names the rule and sends nothing", async () => {
    const h = rulesetRepo(scene);
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/required_linear_history/);
    expect(h.err()).toMatch(/--allow-removal/);
    expect(mutations(h)).toEqual([]);
  });

  it("removes the rule from main when --allow-removal is given", async () => {
    const h = rulesetRepo(scene);
    expect(await run(sync("--confirm", "--allow-removal"), h.deps)).toBe(0);
    expect(sent(h)).toEqual([
      ["PUT", "7", expect.objectContaining({ rules: [DELETION, CHECKS] })],
    ]);
  });

  it("names a rule main gains as added once the candidate has shown it", async () => {
    const h = rulesetRepo({
      main: liveMain([DELETION]),
      candidate: liveCandidate([CHECKS]),
    });
    await run([...sync("--dry-run"), "--json"], h.deps);
    expect(JSON.parse(h.out()).main.added).toEqual(["required_status_checks"]);
  });
});

describe("harness ruleset sync is serialized per repository", () => {
  const change = { main: liveMain([DELETION]) };

  it("refuses while another sync holds the lock, naming the file, and sends nothing", async () => {
    const h = rulesetRepo(change);
    h.set(LOCK, "{}");
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.err()).toContain(LOCK);
    expect(h.err()).toMatch(/delete/i);
    expect(h.runner.calls).toEqual([]);
  });

  it("holds the lock while it plans and saves, then releases it", async () => {
    const h = rulesetRepo(change);
    let held: string | undefined;
    const original = h.runner.run.bind(h.runner);
    h.runner.run = (command, args, options) => {
      if (args.includes("-X")) {
        held = h.get(LOCK);
      }
      return original(command, args, options);
    };
    expect(await run(sync("--confirm"), h.deps)).toBe(0);
    expect(held).toBeDefined();
    expect(h.get(LOCK)).toBeUndefined();
  });

  it("releases the lock when the save fails", async () => {
    const h = rulesetRepo({
      ...change,
      extra: [
        {
          match: (_c, a) => a.includes("-X"),
          result: { code: 1, stderr: "HTTP 500" },
        },
      ],
    });
    expect(await run(sync("--confirm"), h.deps)).toBe(1);
    expect(h.get(LOCK)).toBeUndefined();
  });

  it("takes no lock for a dry run, which mutates nothing", async () => {
    const h = rulesetRepo(change);
    h.set(LOCK, "{}");
    expect(await run(sync("--dry-run"), h.deps)).toBe(0);
    expect(h.get(LOCK)).toBe("{}");
  });
});

describe("harness ruleset sync read errors", () => {
  it("fails with the gh error when the read fails", async () => {
    const h = rulesetRepo({
      main: liveMain(),
      extra: [
        {
          match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets`,
          result: { code: 1, stderr: "HTTP 404" },
        },
      ],
    });
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toContain("HTTP 404");
  });

  it("says to check the gh version and login when gh prints no JSON", async () => {
    const h = rulesetRepo({
      main: liveMain(),
      extra: [
        {
          match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets`,
          result: { stdout: "not json" },
        },
      ],
    });
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/gh --version/);
    expect(h.err()).toMatch(/gh auth status/);
    expect(h.err()).toMatch(/rerun/i);
  });

  it("names the problem when GitHub does not return a ruleset list", async () => {
    const h = rulesetRepo({
      main: liveMain(),
      extra: [
        {
          match: (_c, a) => a.join(" ") === `api repos/${REPO}/rulesets`,
          result: { stdout: '{"message":"Not Found"}' },
        },
      ],
    });
    expect(await run(sync("--dry-run"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/did not return a list/);
  });
});

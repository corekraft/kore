import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeOf, readInventory } from "../guardrail/index.js";
import {
  DECLARED_DIR,
  candidateName,
  parseDeclared,
  planCandidate,
  planMain,
  ruleName,
  stage,
  typesOf,
} from "./declared.js";
import { GitHubError, GitHubRulesets } from "./github.js";
import { withLock } from "./lock.js";
import { destination } from "./support.js";
import { declaredFields, weakenings } from "./weaken.js";
import { syncRuleset } from "./sync.js";
import {
  REPO,
  ROOT,
  asGitHub,
  candidatePlan as candidate,
  fakeContext,
  fakeDeps,
  fakeGitHub,
  inventoryOf,
  mainPlan,
  type FakeDeps,
  type FakeGitHub,
} from "./ruleset-support.js";

vi.mock("../guardrail/index.js");
vi.mock("./declared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./declared.js")>()),
  candidateName: vi.fn(),
  parseDeclared: vi.fn(),
  planCandidate: vi.fn(),
  planMain: vi.fn(),
  ruleName: vi.fn(),
  stage: vi.fn(),
  typesOf: vi.fn(),
}));
vi.mock("./github.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github.js")>()),
  GitHubRulesets: vi.fn(),
}));
vi.mock("./lock.js");
vi.mock("./support.js");
vi.mock("./weaken.js");

const DECLARED = `${ROOT}/${DECLARED_DIR}/main.json`;
const flags = (extra: Record<string, string | boolean> = {}) => ({
  repo: REPO,
  target: "main",
  ...extra,
});

let deps: FakeDeps;
let github: FakeGitHub;

beforeEach(() => {
  deps = fakeDeps();
  github = fakeGitHub();
  deps.fs.readFile.mockResolvedValue("{}");
  vi.mocked(parseDeclared).mockReturnValue({ name: "main", rules: [] });
  vi.mocked(readInventory).mockResolvedValue(
    inventoryOf("main-ruleset-deletion"),
  );
  vi.mocked(modeOf).mockReturnValue("enforce");
  vi.mocked(typesOf).mockReturnValue(["deletion"]);
  vi.mocked(ruleName).mockImplementation(
    (target, type) => `${target}-ruleset-${type}`,
  );
  vi.mocked(candidateName).mockReturnValue("main-candidate");
  vi.mocked(destination).mockReturnValue({ repo: REPO, target: "main" });
  vi.mocked(stage).mockReturnValue({ main: [], candidate: [], pending: [] });
  vi.mocked(planMain).mockReturnValue(mainPlan());
  vi.mocked(planCandidate).mockReturnValue(candidate());
  vi.mocked(declaredFields).mockReturnValue({});
  vi.mocked(weakenings).mockReturnValue({ removed: [], weaker: [] });
  vi.mocked(withLock).mockImplementation((_deps, _repo, action) => action());
  vi.mocked(GitHubRulesets).mockImplementation(function () {
    return asGitHub(github);
  });
  github.find.mockResolvedValue(undefined);
  github.save.mockResolvedValue(undefined);
});

const sync = (options: Record<string, string | boolean>, json = false) =>
  syncRuleset(fakeContext(flags(options), deps, json));

describe("syncRuleset reads the declared ruleset and refuses one it cannot use", () => {
  it("refuses a target the repository declares no file for, naming the directory", async () => {
    deps.fs.readFile.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    await expect(sync({ "dry-run": true })).rejects.toThrow(
      `The repository declares no ruleset "main" (no ${DECLARED_DIR}/main.json); it declares the rulesets under ${DECLARED_DIR}, such as main. Check --target.`,
    );
    expect(deps.fs.readFile.mock.calls).toEqual([[DECLARED]]);
  });

  it("rethrows a read failure that is not a missing file", async () => {
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    deps.fs.readFile.mockRejectedValue(denied);
    await expect(sync({ "dry-run": true })).rejects.toBe(denied);
  });

  it("refuses a declared name that differs from --target, so a sync never renames main", async () => {
    vi.mocked(parseDeclared).mockReturnValue({ name: "renamed", rules: [] });
    await expect(sync({ "dry-run": true })).rejects.toThrow(
      `${DECLARED_DIR}/main.json names the ruleset "renamed" but --target is main, and a sync never renames a live ruleset. Fix the "name" in ${DECLARED_DIR}/main.json to main, or pass the matching --target.`,
    );
    expect(github.find).not.toHaveBeenCalled();
  });

  it("refuses a declared rule with no guardrail inventory entry, naming the rule to add", async () => {
    vi.mocked(readInventory).mockResolvedValue(inventoryOf());
    await expect(sync({ "dry-run": true })).rejects.toThrow(
      "The guardrail inventory has no main-ruleset-deletion rule, so the mode of the deletion rule is undeclared. Add it to .claude/guardrails.yaml (enforce if main already has the rule live, else audit), then rerun.",
    );
    expect(github.find).not.toHaveBeenCalled();
  });
});

describe("syncRuleset reports a dry run and changes nothing", () => {
  it("prints the planned main and candidate changes, takes no lock and saves nothing", async () => {
    vi.mocked(planMain).mockReturnValue(
      mainPlan({ action: "update", from: "evaluate", added: ["deletion"] }),
    );
    vi.mocked(planCandidate).mockReturnValue(
      candidate({ action: "create", rules: ["required_status_checks"] }),
    );
    expect(await sync({ "dry-run": true })).toBe(0);
    expect(deps.stdout.mock.calls).toEqual([
      [
        "Ruleset main in corekraft/kore: dry run, nothing changed. Planned:\n  main: update (evaluate -> active); added: deletion\n  main-candidate: create (evaluate); rules: required_status_checks\n",
      ],
    ]);
    expect(withLock).not.toHaveBeenCalled();
    expect(github.save).not.toHaveBeenCalled();
  });

  it("reports the plan as json with the dry-run and refused flags", async () => {
    vi.mocked(planMain).mockReturnValue(mainPlan({ action: "update" }));
    expect(await sync({ "dry-run": true }, true)).toBe(0);
    const report = JSON.parse(String(deps.stdout.mock.calls[0]?.[0]));
    expect(report).toMatchObject({
      repo: REPO,
      target: "main",
      dryRun: true,
      refused: false,
      main: { action: "update", enforcement: "active" },
    });
    expect(report.main).not.toHaveProperty("body");
  });
});

describe("syncRuleset refuses a change that weakens main, or that the operator has not confirmed", () => {
  it("refuses a removed rule without --allow-removal, names it, and sends nothing", async () => {
    vi.mocked(planMain).mockReturnValue(
      mainPlan({ action: "update", removed: ["required_linear_history"] }),
    );
    await expect(sync({ confirm: true })).rejects.toThrow(
      "Ruleset main in corekraft/kore would weaken main (removes required_linear_history), so nothing was sent. Instead, restore it in .github/rulesets/main.json, or rerun with --allow-removal once the operator agrees.",
    );
    expect(github.save).not.toHaveBeenCalled();
  });

  it("names the weakenings the declared file makes to live main", async () => {
    github.find.mockResolvedValueOnce({ id: 7, rules: [] });
    vi.mocked(planMain).mockReturnValue(mainPlan({ action: "update" }));
    vi.mocked(weakenings).mockReturnValue({
      removed: [],
      weaker: ["pull_request.required_approving_review_count is lowered"],
    });
    await expect(sync({ confirm: true })).rejects.toThrow(
      "would weaken main (pull_request.required_approving_review_count is lowered), so nothing was sent.",
    );
  });

  it("proceeds past a weakening when --allow-removal is given, still needing --confirm", async () => {
    vi.mocked(planMain).mockReturnValue(
      mainPlan({ action: "update", removed: ["deletion"] }),
    );
    await expect(sync({ "allow-removal": true })).rejects.toThrow(
      "would change, but nothing was sent. Changing the live ruleset needs the operator's confirmation first:",
    );
    expect(github.save).not.toHaveBeenCalled();
  });

  it("asks for --confirm before any change, showing the plan and sending nothing", async () => {
    vi.mocked(planMain).mockReturnValue(
      mainPlan({ action: "update", from: "evaluate" }),
    );
    await expect(sync({})).rejects.toThrow(
      "Ruleset main in corekraft/kore would change, but nothing was sent. Changing the live ruleset needs the operator's confirmation first:\n  main: update (evaluate -> active)\n  main-candidate: no change\nPreview with --dry-run, then rerun with --confirm once the operator agrees.",
    );
    expect(github.save).not.toHaveBeenCalled();
  });
});

describe("syncRuleset takes each rule's mode from the inventory", () => {
  it("reads the guardrail inventory through the file system, from the repository root", async () => {
    vi.mocked(readInventory).mockImplementation(async (readFile) => {
      await readFile("probe");
      return inventoryOf("main-ruleset-deletion");
    });
    await sync({ "dry-run": true });
    expect(deps.fs.readFile.mock.calls).toEqual([[DECLARED], ["probe"]]);
    expect(vi.mocked(readInventory).mock.calls[0]?.[1]).toBe(ROOT);
  });

  it("hands staging a mode lookup that reads each rule's inventory entry", async () => {
    vi.mocked(modeOf).mockImplementation((_inventory, rule) =>
      rule.endsWith("checks") ? "audit" : "enforce",
    );
    await sync({ "dry-run": true });
    const [, modes] = vi.mocked(stage).mock.calls[0] ?? [];
    expect(modes?.("checks")).toBe("audit");
    expect(modes?.("deletion")).toBe("enforce");
  });

  it("keeps live main's audit rules when it judges the weakenings, beside the declared enforce rules", async () => {
    vi.mocked(modeOf).mockImplementation((_inventory, rule) =>
      rule.endsWith("checks") ? "audit" : "enforce",
    );
    vi.mocked(parseDeclared).mockReturnValue({
      name: "main",
      rules: [{ type: "deletion" }],
    });
    github.find.mockResolvedValueOnce({
      id: 7,
      rules: [{ type: "checks" }, { type: "deletion" }],
    });
    await sync({ "dry-run": true });
    expect(vi.mocked(weakenings).mock.calls).toEqual([
      [{}, { name: "main", rules: [{ type: "deletion" }, { type: "checks" }] }],
    ]);
  });
});

describe("syncRuleset saves the candidate first, then main, under the lock", () => {
  it("saves the candidate before main, and names both in the report", async () => {
    vi.mocked(planMain).mockReturnValue(
      mainPlan({ action: "update", id: 7, from: "evaluate", body: { m: 1 } }),
    );
    vi.mocked(planCandidate).mockReturnValue(
      candidate({ action: "update", id: 8, body: { c: 1 } }),
    );
    expect(await sync({ confirm: true })).toBe(0);
    expect(github.save.mock.calls).toEqual([
      [8, { c: 1 }],
      [7, { m: 1 }],
    ]);
    expect(withLock).toHaveBeenCalledWith(deps, REPO, expect.any(Function));
  });

  it("skips a save for a ruleset that has no change, and says there was none", async () => {
    vi.mocked(planMain).mockReturnValue(mainPlan({ action: "none" }));
    expect(await sync({ confirm: true })).toBe(0);
    expect(github.save).not.toHaveBeenCalled();
    expect(deps.stdout.mock.calls).toEqual([
      [
        "Ruleset main in corekraft/kore: no change; main is active and the candidate matches.\n",
      ],
    ]);
  });

  it("reports a change as changed, with the plan that was applied", async () => {
    vi.mocked(planMain).mockReturnValue(
      mainPlan({ action: "update", from: "evaluate" }),
    );
    vi.mocked(planCandidate).mockReturnValue(candidate({ action: "none" }));
    await sync({ confirm: true });
    expect(deps.stdout.mock.calls).toEqual([
      [
        "Ruleset main in corekraft/kore changed:\n  main: update (evaluate -> active)\n  main-candidate: no change\n",
      ],
    ]);
  });

  it("reads the live main and candidate through the client, then plans from them", async () => {
    await sync({ "dry-run": true });
    expect(github.find.mock.calls).toEqual([["main"], ["main-candidate"]]);
    expect(GitHubRulesets).toHaveBeenCalledWith(deps.runner, REPO);
  });
});

describe("syncRuleset explains a failed evaluate or a failed save", () => {
  const evaluateRefused = (stderr: string) =>
    new GitHubError("gh failed", stderr);

  it("says evaluate is unavailable on this plan, sends main nothing, and changes nothing", async () => {
    vi.mocked(planCandidate).mockReturnValue(candidate({ action: "create" }));
    vi.mocked(planMain).mockReturnValue(mainPlan({ action: "update", id: 7 }));
    github.save.mockRejectedValue(
      evaluateRefused(
        "HTTP 422: Enforcement 'evaluate' requires GitHub Enterprise",
      ),
    );
    await expect(sync({ confirm: true })).rejects.toThrow(
      "GitHub refused evaluate enforcement for main-candidate in corekraft/kore (HTTP 422: Enforcement 'evaluate' requires GitHub Enterprise): evaluate is unavailable on this plan. Nothing was changed. Ask the operator how to activate audit rules without evaluate; main stays active meanwhile.",
    );
    expect(github.save).toHaveBeenCalledTimes(1);
  });

  it("rethrows a 422 that is not about evaluate, as the gh error it is", async () => {
    vi.mocked(planCandidate).mockReturnValue(candidate({ action: "create" }));
    const failure = evaluateRefused("HTTP 422: Invalid property /rules/0");
    github.save.mockRejectedValue(failure);
    await expect(sync({ confirm: true })).rejects.toBe(failure);
  });

  it("rethrows a failed save of main", async () => {
    vi.mocked(planMain).mockReturnValue(mainPlan({ action: "update", id: 7 }));
    const failure = new Error("HTTP 403 forbidden");
    github.save.mockRejectedValue(failure);
    await expect(sync({ confirm: true })).rejects.toBe(failure);
  });
});

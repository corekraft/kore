import { describe, expect, it, vi } from "vitest";
import type { CommandContext, Runner } from "../runtime/index.js";
import {
  gatherChecks,
  gatherExpandStep,
  gatherGuardrailChanges,
  lengthAudit,
  parsePrView,
  type Checks,
  type PrView,
} from "./checks.js";
import { parseDeclaration, type Declaration } from "./declaration.js";
import { parseDiff, type ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import { hintsFor, type Hints } from "./hints.js";
import { withManifestSides } from "./manifest-source.js";
import { precheck } from "./precheck.js";
import { fakeDeps } from "./precheck-support.js";
import { assess } from "./verdict.js";

// Every collaborator of the precheck is mocked: its behaviour is the wiring the
// tests below check, not what each collaborator computes.
vi.mock("./checks.js");
vi.mock("./declaration.js");
vi.mock("./diff.js");
vi.mock("./hints.js");
vi.mock("./manifest-source.js");
vi.mock("./verdict.js");

const ROOT = "/repo";
const REPO = "corekraft/kore";
const BASE = "base0000";
const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const REVIEWERS = ["reviewer-bot"];
const VIEW_ARGS = [
  "pr",
  "view",
  "42",
  "--json",
  "baseRefOid,body,comments,commits,headRefOid,statusCheckRollup",
  "--repo",
  REPO,
];
const DIFF_ARGS = ["pr", "diff", "42", "--repo", REPO];

const PR_VIEW: PrView = {
  baseSha: BASE,
  body: "Safety pattern: feature-flagged",
  comments: [],
  headCommittedAt: undefined,
  headSha: HEAD,
  rollup: [],
};
const PASSING: Checks = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  principlesReview: { result: "pass" },
};
const HINTS: Hints = { flags: [], flagPresentAndOff: true };
const FILES: ChangedFile[] = [];
const DECLARED: Declaration = {
  ok: true,
  pattern: "feature-flagged",
  idea: "#10",
  expandStep: undefined,
};

const runner = { run: vi.fn<Runner["run"]>() };
const context = (): CommandContext => ({
  json: false,
  options: {},
  deps: fakeDeps(runner),
});
const run = () => precheck(context(), ROOT, REPO, 42, REVIEWERS);

/** A PR that passes every check and whose diff matches its declared pattern. */
function ready(): void {
  runner.run.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  vi.mocked(parsePrView).mockReturnValue(PR_VIEW);
  vi.mocked(parseDeclaration).mockReturnValue(DECLARED);
  vi.mocked(parseDiff).mockReturnValue(FILES);
  vi.mocked(withManifestSides).mockResolvedValue(FILES);
  vi.mocked(hintsFor).mockReturnValue(HINTS);
  vi.mocked(gatherChecks).mockResolvedValue(PASSING);
  vi.mocked(lengthAudit).mockResolvedValue([]);
  vi.mocked(assess).mockReturnValue({
    patternMatches: true,
    clusterFacing: false,
    unverified: [],
  });
}

describe("precheck stops at a PR whose declaration is invalid", () => {
  it("reports not ready from the declaration alone, reading no diff and no check", async () => {
    ready();
    vi.mocked(parseDeclaration).mockReturnValue({
      ok: false,
      reason: "The PR declares no safety pattern.",
    });
    expect(await run()).toEqual({
      pr: 42,
      ok: false,
      reviewers: REVIEWERS,
      pattern: undefined,
      idea: undefined,
      declaration: { ok: false, reason: "The PR declares no safety pattern." },
    });
    expect(parseDiff).not.toHaveBeenCalled();
    expect(gatherChecks).not.toHaveBeenCalled();
    expect(assess).not.toHaveBeenCalled();
  });

  it("reads the PR through gh for the named repository, and only that", async () => {
    ready();
    vi.mocked(parseDeclaration).mockReturnValue({ ok: false, reason: "x" });
    await run();
    expect(runner.run).toHaveBeenCalledExactlyOnceWith("gh", VIEW_ARGS, {
      cwd: ROOT,
    });
  });
});

describe("precheck is ready only when the pattern matches and every check passes", () => {
  it("is ready, with the head, idea and hints, when the pattern matches and every check passes", async () => {
    ready();
    expect(await run()).toEqual({
      pr: 42,
      head: HEAD,
      reviewers: REVIEWERS,
      ok: true,
      pattern: "feature-flagged",
      idea: "#10",
      declaration: { ok: true },
      checks: PASSING,
      hints: HINTS,
      patternMatches: true,
      clusterFacing: false,
      unverified: [],
    });
  });

  it("is not ready when a check fails, even though the pattern matches", async () => {
    ready();
    vi.mocked(gatherChecks).mockResolvedValue({
      ...PASSING,
      scan: { result: "fail", detail: "scan: FAILURE" },
    });
    expect((await run()).ok).toBe(false);
  });

  it("is not ready when the diff contradicts the declared pattern, and carries the mismatch", async () => {
    ready();
    vi.mocked(assess).mockReturnValue({
      patternMatches: false,
      patternMismatch: "feature-flagged, but the diff adds no flag",
      clusterFacing: false,
      unverified: [],
    });
    expect(await run()).toMatchObject({
      ok: false,
      patternMatches: false,
      patternMismatch: "feature-flagged, but the diff adds no flag",
    });
  });
});

describe("precheck hands each step the PR's own commits and files", () => {
  it("reads the diff through gh for the same repository", async () => {
    ready();
    await run();
    expect(runner.run).toHaveBeenCalledWith("gh", DIFF_ARGS, { cwd: ROOT });
  });

  it("reads the manifest sides between the PR's own base and head", async () => {
    ready();
    await run();
    expect(withManifestSides).toHaveBeenCalledExactlyOnceWith(
      FILES,
      expect.any(Function),
      REPO,
      BASE,
      HEAD,
    );
  });

  it("gives the manifest reader gh api calls through the same runner, in the repository root", async () => {
    ready();
    await run();
    const api = vi.mocked(withManifestSides).mock.calls[0]?.[1];
    await api?.(["api", "repos/corekraft/kore/contents/x"]);
    expect(runner.run).toHaveBeenLastCalledWith(
      "gh",
      ["api", "repos/corekraft/kore/contents/x"],
      { cwd: ROOT },
    );
  });

  it("gives the declared pattern and the diff's files to the hints, then to the verdict", async () => {
    ready();
    await run();
    expect(hintsFor).toHaveBeenCalledExactlyOnceWith("feature-flagged", FILES);
    expect(assess).toHaveBeenCalledExactlyOnceWith(
      "feature-flagged",
      HINTS,
      FILES,
    );
  });
});

describe("precheck carries the inventory changes a diff makes", () => {
  it("adds them to the report, and adds nothing when the inventory is untouched", async () => {
    ready();
    vi.mocked(gatherGuardrailChanges).mockResolvedValue(["a:audit>enforce"]);
    expect(await run()).toMatchObject({
      guardrailChanges: ["a:audit>enforce"],
    });
    expect(vi.mocked(gatherGuardrailChanges).mock.calls[0]?.slice(1)).toEqual([
      expect.any(Function),
      REPO,
      BASE,
      HEAD,
    ]);
    vi.mocked(gatherGuardrailChanges).mockResolvedValue(undefined);
    expect(await run()).not.toHaveProperty("guardrailChanges");
  });
});

describe("precheck names a gh failure instead of reporting a verdict", () => {
  it("throws a judge error naming the gh call, the PR and its stderr", async () => {
    runner.run.mockResolvedValue({ stdout: "", stderr: "no auth\n", code: 1 });
    await expect(run()).rejects.toBeInstanceOf(JudgeError);
    await expect(run()).rejects.toThrow(
      "gh pr view failed for PR #42: no auth. Check `gh auth status`",
    );
  });

  it("throws when gh returns output that cannot be read as a PR", async () => {
    runner.run.mockResolvedValue({ stdout: "x", stderr: "", code: 0 });
    vi.mocked(parsePrView).mockReturnValue(undefined);
    await expect(run()).rejects.toThrow(
      "gh returned unreadable output for PR #42.",
    );
  });
});

describe("precheck reads a contract's expand step only when its diff needs one", () => {
  const CONTRACT: Declaration = {
    ok: true,
    pattern: "expand-contract",
    idea: "#502",
    expandStep: 547,
  };
  const MISMATCH = {
    patternMatches: false,
    clusterFacing: false,
    unverified: [],
  };
  const CLEAN = { patternMatches: true, clusterFacing: false, unverified: [] };

  it("reads no expand step when the diff already matches the pattern", async () => {
    ready();
    vi.mocked(parseDeclaration).mockReturnValue(CONTRACT);
    await run();
    expect(gatherExpandStep).not.toHaveBeenCalled();
  });

  it("reads no expand step when the PR declares none, even though the diff mismatches", async () => {
    ready();
    vi.mocked(assess).mockReturnValue(MISMATCH);
    await run();
    expect(gatherExpandStep).not.toHaveBeenCalled();
  });

  it("passes a proven expand step to the verdict, and the contract is ready", async () => {
    ready();
    vi.mocked(parseDeclaration).mockReturnValue(CONTRACT);
    vi.mocked(assess).mockReturnValueOnce(MISMATCH).mockReturnValueOnce(CLEAN);
    vi.mocked(gatherExpandStep).mockResolvedValue({ result: "pass" });
    expect(await run()).toMatchObject({
      ok: true,
      checks: { ...PASSING, expandStep: { result: "pass" } },
    });
    expect(gatherExpandStep).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pr: 42,
        view: PR_VIEW,
        reviewers: REVIEWERS,
        declared: { idea: "#502", expandStep: 547 },
      }),
    );
    expect(assess).toHaveBeenLastCalledWith(
      "expand-contract",
      HINTS,
      FILES,
      true,
    );
  });

  it("refuses a contract whose expand step is not proven, carrying the check's reason", async () => {
    ready();
    vi.mocked(parseDeclaration).mockReturnValue(CONTRACT);
    vi.mocked(assess).mockReturnValue(MISMATCH);
    vi.mocked(gatherExpandStep).mockResolvedValue({
      result: "missing",
      detail: "no proof",
    });
    expect(await run()).toMatchObject({
      ok: false,
      checks: {
        ...PASSING,
        expandStep: { result: "missing", detail: "no proof" },
      },
    });
  });
});

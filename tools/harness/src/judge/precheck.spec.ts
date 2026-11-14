import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { gatherChecks, parsePrView, type PrView } from "./checks.js";
import { parseDeclaration } from "./declaration.js";
import { parseDiff } from "./diff.js";
import { JudgeError } from "./errors.js";
import { hintsFor } from "./hints.js";
import { withManifestSides } from "./manifest-source.js";
import { precheck, readPr, summary } from "./precheck.js";
import { assess } from "./verdict.js";

vi.mock("./checks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./checks.js")>()),
  gatherChecks: vi.fn(),
  parsePrView: vi.fn(),
}));
vi.mock("./declaration.js");
vi.mock("./diff.js");
vi.mock("./hints.js");
vi.mock("./manifest-source.js");
vi.mock("./verdict.js");

const ROOT = "/repo";
const REPO = "corekraft/kore";
const HEAD = "abc1234def5678";

const VIEW: PrView = {
  baseSha: "base1",
  body: "Safety pattern: no-behaviour-change",
  comments: [],
  headCommittedAt: undefined,
  headSha: HEAD,
  rollup: [],
};

const PASSING = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  principlesReview: { result: "pass" },
};

function contextOf(runOut = "{}", code = 0) {
  const run = vi.fn().mockResolvedValue({ stdout: runOut, stderr: "", code });
  const context = {
    deps: { runner: { run } },
  } as unknown as CommandContext;
  return { context, run };
}

describe("judge PR reading", () => {
  it("reads the PR through gh, named to the repository, and parses it", async () => {
    const { context, run } = contextOf('{"x":1}');
    vi.mocked(parsePrView).mockReturnValue(VIEW);

    expect(await readPr(context, ROOT, REPO, 42)).toBe(VIEW);
    expect(run.mock.calls).toEqual([
      [
        "gh",
        [
          "pr",
          "view",
          "42",
          "--json",
          "baseRefOid,body,comments,commits,headRefOid,statusCheckRollup",
          "--repo",
          REPO,
        ],
        { cwd: ROOT },
      ],
    ]);
  });

  it("refuses output it cannot parse, and names the fix", async () => {
    const { context } = contextOf("garbage");
    vi.mocked(parsePrView).mockReturnValue(undefined);

    await expect(readPr(context, ROOT, REPO, 42)).rejects.toThrow(
      new JudgeError(
        "gh returned unreadable output for PR #42. Check `gh auth status` and the PR number, then rerun `harness judge precheck <pr>`.",
      ),
    );
  });

  it("refuses when gh fails, with its error and the fix", async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "denied\n", code: 1 });
    const context = { deps: { runner: { run } } } as unknown as CommandContext;

    await expect(readPr(context, ROOT, REPO, 42)).rejects.toThrow(
      "gh pr view failed for PR #42: denied. Check `gh auth status`",
    );
  });
});

function ready(verdictMatches = true) {
  vi.mocked(parsePrView).mockReturnValue(VIEW);
  vi.mocked(parseDeclaration).mockReturnValue({
    ok: true,
    pattern: "no-behaviour-change",
    idea: "#193",
  } as never);
  vi.mocked(parseDiff).mockReturnValue(["files"] as never);
  vi.mocked(gatherChecks).mockResolvedValue(PASSING as never);
  vi.mocked(withManifestSides).mockResolvedValue(["files"] as never);
  vi.mocked(hintsFor).mockReturnValue({ docs: true } as never);
  vi.mocked(assess).mockReturnValue({
    patternMatches: verdictMatches,
    clusterFacing: false,
  } as never);
}

describe("judge precheck: declaration", () => {
  it("fails before reading the diff or any check when the declaration is invalid", async () => {
    const { context, run } = contextOf();
    vi.mocked(parsePrView).mockReturnValue(VIEW);
    vi.mocked(parseDeclaration).mockReturnValue({
      ok: false,
      reason: "no safety pattern declared",
    } as never);

    expect(await precheck(context, ROOT, REPO, 42, ["bot"])).toEqual({
      pr: 42,
      ok: false,
      pattern: undefined,
      idea: undefined,
      declaration: { ok: false, reason: "no safety pattern declared" },
      reviewers: ["bot"],
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(gatherChecks).not.toHaveBeenCalled();
  });
});

describe("judge precheck: verdict", () => {
  it("passes a PR whose pattern matches and whose checks all pass, at the head it verified", async () => {
    const { context } = contextOf("diff text");
    ready();

    const report = await precheck(context, ROOT, REPO, 42, ["bot"]);
    expect(report).toEqual({
      pr: 42,
      head: HEAD,
      ok: true,
      pattern: "no-behaviour-change",
      idea: "#193",
      declaration: { ok: true },
      reviewers: ["bot"],
      checks: PASSING,
      hints: { docs: true },
      patternMatches: true,
      clusterFacing: false,
    });
    expect(gatherChecks).toHaveBeenCalledWith(
      expect.anything(),
      ROOT,
      REPO,
      VIEW,
      ["bot"],
    );
    expect(withManifestSides).toHaveBeenCalledWith(
      ["files"],
      expect.any(Function),
      REPO,
      "base1",
      HEAD,
    );
  });
});

describe("judge precheck: manifest sides", () => {
  it("asks gh for the manifest sides through the same runner as the rest of the precheck", async () => {
    const { context, run } = contextOf("diff text");
    ready();
    vi.mocked(withManifestSides).mockImplementation(async (files, runGh) => {
      await runGh(["api", "repos/x/contents/tools/kore/package.json"]);
      return [...files];
    });

    await precheck(context, ROOT, REPO, 42, []);
    expect(run.mock.calls.at(-1)).toEqual([
      "gh",
      ["api", "repos/x/contents/tools/kore/package.json"],
      { cwd: ROOT },
    ]);
  });

  it("fails a PR whose check does not pass, even when the pattern matches", async () => {
    const { context } = contextOf("diff text");
    ready();
    vi.mocked(gatherChecks).mockResolvedValue({
      ...PASSING,
      ci: { result: "fail", detail: "check: FAILURE" },
    } as never);

    expect((await precheck(context, ROOT, REPO, 42, [])).ok).toBe(false);
  });

  it("fails a PR whose diff does not match its declared pattern", async () => {
    const { context } = contextOf("diff text");
    ready(false);

    expect((await precheck(context, ROOT, REPO, 42, [])).ok).toBe(false);
  });
});

describe("judge precheck summary", () => {
  it("says a PR with no checks read is not ready, and gives the declaration's reason", () => {
    expect(
      summary({
        pr: 42,
        ok: false,
        pattern: undefined,
        idea: undefined,
        declaration: { ok: false, reason: "no safety pattern declared" },
      } as never),
    ).toBe("PR #42: not ready\nno safety pattern declared\n");
  });

  it("names no pattern or idea when none is declared, and reports the cluster-facing flag as false when unset", () => {
    const text = summary({
      pr: 42,
      ok: true,
      pattern: undefined,
      idea: undefined,
      declaration: { ok: true },
      reviewers: ["bot"],
      checks: PASSING,
    } as never);
    expect(text).toBe(
      [
        "PR #42: ready for the judge",
        "pattern: none",
        "reviewers: bot",
        "ci: pass",
        "scan: pass",
        "coverage: pass",
        "principlesReview: pass",
        "cluster-facing: false",
        "",
      ].join("\n"),
    );
  });
});

describe("judge precheck summary: lines", () => {
  it("lists the pattern, each check, hints, mismatch, cluster-facing and unverified lines", () => {
    const text = summary({
      pr: 42,
      ok: false,
      head: HEAD,
      pattern: "no-behaviour-change",
      idea: "#193",
      declaration: { ok: true },
      reviewers: ["bot"],
      checks: {
        ci: { result: "pass" },
        scan: { result: "fail", detail: "scan: FAILURE" },
        coverage: { result: "pass" },
        principlesReview: { result: "missing" },
      },
      hints: { docs: true },
      patternMismatch: "touches tools/kore",
      clusterFacing: true,
      unverified: ["the review"],
    } as never);
    expect(text).toBe(
      [
        "PR #42: not ready",
        "pattern: no-behaviour-change (idea #193)",
        "reviewers: bot",
        "ci: pass",
        "scan: fail (scan: FAILURE)",
        "coverage: pass",
        "principlesReview: missing",
        "hint docs: true",
        "pattern mismatch: touches tools/kore",
        "cluster-facing: true",
        "unverified: the review",
        "",
      ].join("\n"),
    );
  });
});

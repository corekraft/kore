import { describe, expect, it, vi } from "vitest";
import type { CommandContext, Runner } from "../runtime/index.js";
import {
  castAudit,
  closingAudit,
  gatherChecks,
  lengthAudit,
  parsePrView,
  type AuditFinding,
  type Checks,
  type PrView,
} from "./checks.js";
import { parseDeclaration, type Declaration } from "./declaration.js";
import { parseDiff, type ChangedFile } from "./diff.js";
import { hintsFor, type Hints } from "./hints.js";
import { withManifestSides } from "./manifest-source.js";
import { precheck } from "./precheck.js";
import { fakeDeps } from "./precheck-support.js";
import { assess } from "./verdict.js";

// The audit items of the precheck: the collaborators are mocked, so each test states what the
// diff and the lint's count are, and what the report must carry for them.
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
const FINDING: AuditFinding = {
  item: "file-length",
  file: "tools/harness/src/a.ts",
  detail: "301 non-blank, non-comment lines; the limit is 300",
  fix: "split it into smaller modules",
};
const CAST: AuditFinding = {
  item: "type-cast",
  file: "tools/harness/src/a.spec.ts",
  line: 12,
  detail: "as never",
  fix: "replace the cast with a type guard or a corrected declared type",
};
const CLOSING: AuditFinding = {
  item: "closing-keyword",
  file: "PR body",
  detail: "Closes #54",
  fix: "replace it with Refs #54 (ADR 0097)",
};

const runner = { run: vi.fn<Runner["run"]>() };
const context = (): CommandContext => ({
  json: false,
  options: {},
  deps: fakeDeps(runner),
});
const run = () => precheck(context(), ROOT, REPO, 42, ["reviewer-bot"]);

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
  vi.mocked(castAudit).mockReturnValue([]);
  vi.mocked(closingAudit).mockReturnValue([]);
  vi.mocked(assess).mockReturnValue({
    patternMatches: true,
    clusterFacing: false,
    unverified: [],
  });
}

describe("precheck carries the audit findings the changed files make", () => {
  it("adds them to the report, and the PR stays ready: an audit finding never fails the check", async () => {
    ready();
    vi.mocked(lengthAudit).mockResolvedValue([FINDING]);
    expect(await run()).toMatchObject({ ok: true, audits: [FINDING] });
  });

  it("adds a type-cast finding to the audits, and the PR stays ready: a cast never fails the check", async () => {
    ready();
    vi.mocked(castAudit).mockReturnValue([CAST]);
    expect(await run()).toMatchObject({ ok: true, audits: [CAST] });
  });

  it("lists the file-length findings before the type-cast findings, each as its item made them", async () => {
    ready();
    vi.mocked(lengthAudit).mockResolvedValue([FINDING]);
    vi.mocked(castAudit).mockReturnValue([CAST]);
    expect(await run()).toMatchObject({ audits: [FINDING, CAST] });
  });

  it("adds a closing-keyword finding to the audits, and the PR stays ready: a keyword never fails the check", async () => {
    ready();
    vi.mocked(closingAudit).mockReturnValue([CLOSING]);
    expect(await run()).toMatchObject({ ok: true, audits: [CLOSING] });
  });

  it("lists the closing-keyword findings after the type-cast findings, each as its item made them", async () => {
    ready();
    vi.mocked(lengthAudit).mockResolvedValue([FINDING]);
    vi.mocked(castAudit).mockReturnValue([CAST]);
    vi.mocked(closingAudit).mockReturnValue([CLOSING]);
    expect(await run()).toMatchObject({ audits: [FINDING, CAST, CLOSING] });
  });

  it("reads the closing keywords of the PR body with the idea the declaration names", async () => {
    ready();
    await run();
    expect(closingAudit).toHaveBeenCalledWith(PR_VIEW.body, DECLARED.idea);
  });

  it("reads the casts of the PR's own changed files, from the diff alone", async () => {
    ready();
    await run();
    expect(castAudit).toHaveBeenCalledWith(FILES);
  });

  it("reads the lengths of the PR's own files at its head commit, through the repository's gh api", async () => {
    ready();
    await run();
    expect(vi.mocked(lengthAudit).mock.calls[0]).toEqual([
      expect.any(Function),
      REPO,
      HEAD,
      FILES,
    ]);
  });

  it("adds no audits field when no changed file is over the limit", async () => {
    ready();
    expect(await run()).not.toHaveProperty("audits");
  });

  it("reads no file length when the declaration is invalid", async () => {
    ready();
    vi.mocked(parseDeclaration).mockReturnValue({ ok: false, reason: "x" });
    await run();
    expect(lengthAudit).not.toHaveBeenCalled();
  });
});

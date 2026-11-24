import { describe, expect, it, vi } from "vitest";
import type { CommandContext, Runner } from "../runtime/index.js";
import {
  castAudit,
  closingAudit,
  gatherChecks,
  hostnameClaims,
  lengthAudit,
  parsePrView,
  type Checks,
  type PrView,
} from "./checks.js";
import { parseDeclaration, type Declaration } from "./declaration.js";
import { parseDiff } from "./diff.js";
import { hintsFor, type Hints } from "./hints.js";
import { withManifestSides } from "./manifest-source.js";
import { precheck, summary } from "./precheck.js";
import { fakeDeps } from "./precheck-support.js";
import { assess } from "./verdict.js";

// The precheck's own wiring, with its collaborators mocked as precheck.spec.ts does: what
// this file checks is how the hostname claims enter the report and the readiness.
vi.mock("./checks.js");
vi.mock("./declaration.js");
vi.mock("./diff.js");
vi.mock("./hints.js");
vi.mock("./manifest-source.js");
vi.mock("./verdict.js");

const REPO = "corekraft/kore";
const BASE = "main-tip";
const HEAD = "pr-head";
const PASSING: Checks = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  principlesReview: { result: "pass" },
};
const CONTESTED =
  'infra/environments/local/services/portal.json: spec.hostnames[0] "login.kore.internal" is already claimed by infra/environments/local/services/login.json (service login in suborg platform)';

const runner = { run: vi.fn<Runner["run"]>() };
const context = (): CommandContext => ({
  json: false,
  options: {},
  deps: fakeDeps(runner),
});
const run = () => precheck(context(), "/repo", REPO, 42, ["reviewer-bot"]);

/** A PR that passes every check and matches its declared pattern, so only the hostname claims can refuse it. */
function ready(): void {
  runner.run.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
  vi.mocked(parsePrView).mockReturnValue({
    baseSha: BASE,
    body: "Safety pattern: feature-flagged",
    comments: [],
    headCommittedAt: undefined,
    headSha: HEAD,
    rollup: [],
  } as PrView);
  vi.mocked(parseDeclaration).mockReturnValue({
    ok: true,
    pattern: "feature-flagged",
    idea: "#10",
    expandStep: undefined,
  } as Declaration);
  vi.mocked(parseDiff).mockReturnValue([]);
  vi.mocked(withManifestSides).mockResolvedValue([]);
  vi.mocked(hintsFor).mockReturnValue({} as Hints);
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

describe("precheck reads the hostname claims of the PR against main", () => {
  it("reads the claims between the base the PR named and its head", async () => {
    ready();
    vi.mocked(hostnameClaims).mockResolvedValue({
      touches: false,
      behindBy: 0,
      refusals: [],
    });
    await run();
    expect(hostnameClaims).toHaveBeenCalledWith(
      expect.objectContaining({ repo: REPO, mainSha: BASE, headSha: HEAD }),
    );
  });

  it("is not ready, and names the refusal, when a claim is contested", async () => {
    ready();
    vi.mocked(hostnameClaims).mockResolvedValue({
      touches: true,
      behindBy: 0,
      refusals: [CONTESTED],
    });
    const report = await run();
    expect(report.ok).toBe(false);
    expect(report.hostnames).toEqual({
      touches: true,
      behindBy: 0,
      refusals: [CONTESTED],
    });
    expect(summary(report)).toContain(CONTESTED);
  });

  it("is not ready, and says to update from main, when a stale PR touches hostnames", async () => {
    ready();
    vi.mocked(hostnameClaims).mockResolvedValue({
      touches: true,
      behindBy: 2,
      refusals: ["the PR is 2 commits behind main: update from main"],
    });
    const report = await run();
    expect(report.ok).toBe(false);
    expect(summary(report)).toContain("update from main");
  });

  it("is ready as before, carrying the claims it read, when every claim holds", async () => {
    ready();
    vi.mocked(hostnameClaims).mockResolvedValue({
      touches: true,
      behindBy: 0,
      refusals: [],
    });
    const report = await run();
    expect(report.ok).toBe(true);
    expect(report.hostnames).toEqual({
      touches: true,
      behindBy: 0,
      refusals: [],
    });
  });

  it("leaves the report as it was for a PR that touches no hostname", async () => {
    ready();
    vi.mocked(hostnameClaims).mockResolvedValue({
      touches: false,
      behindBy: 3,
      refusals: [],
    });
    const report = await run();
    expect(report.ok).toBe(true);
    expect(report).not.toHaveProperty("hostnames");
  });
});

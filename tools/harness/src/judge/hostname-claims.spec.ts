import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import type { ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";
import { CATALOG_PATH } from "./hostname-claims-tree.js";
import { hostnameClaims } from "./hostname-claims.js";
import { cliBuilt, validateRefusals } from "./hostname-claims-validate.js";

// The merge's validation is its own unit (hostname-claims-validate.spec.ts): here it is a
// collaborator whose answer the touch and stale rules read. The GitHub reads are faked.
vi.mock("./hostname-claims-validate.js");

const REPO = "corekraft/kore";
const ROOT = "/judge";
const MAIN = "main-tip";
const HEAD = "pr-head";
const MERGE = "merge-base";
const LOGIN = "infra/environments/local/services/login.json";
const OVERLAY = "infra/environments/local/environment.yaml";
const OTHER = "infra/environments/local/values/x.yaml";

const service = (hostnames: string[], image = "v1") =>
  JSON.stringify({ spec: { organization: "platform", hostnames, image } });

interface Snapshot {
  /** The claim inputs at the PR's merge base, and at its head. */
  before?: Record<string, string>;
  after?: Record<string, string>;
  /** How many commits main has that the PR does not. */
  behindBy: number;
  /** When set, gh api does not name a merge base. */
  noMergeBase?: boolean;
}

/** A gh api fake answering from one snapshot: a missing file is a 404, as gh reports it. */
function apiFor(snapshot: Snapshot) {
  const answers: Record<string, string> = {
    [`repos/${REPO}/compare/${MAIN}...${HEAD}`]: JSON.stringify({
      behind_by: snapshot.behindBy,
      merge_base_commit: snapshot.noMergeBase ? {} : { sha: MERGE },
    }),
  };
  for (const [sha, files] of [
    [MERGE, snapshot.before],
    [HEAD, snapshot.after],
  ] as const) {
    for (const [path, text] of Object.entries(files ?? {})) {
      answers[`repos/${REPO}/contents/${path}?ref=${sha}`] = text;
    }
  }
  return vi.fn(async (args: readonly string[]) => {
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const answer = answers[endpoint];
    if (answer !== undefined) {
      return answer;
    }
    if (endpoint.includes("/contents/")) {
      throw new Error("gh api failed: gh: Not Found (HTTP 404)");
    }
    throw new Error(`unexpected call ${endpoint}`);
  });
}

function changed(path: string, deleted = false): ChangedFile {
  return {
    path,
    previousPath: path,
    deleted,
    added: [],
    addedLines: [],
    removed: 0,
    netRemoved: 0,
    after: [],
    trail: [],
  };
}

function check(snapshot: Snapshot, files: ChangedFile[]) {
  const api = apiFor(snapshot);
  return {
    api,
    run: hostnameClaims({
      api,
      runner: {} as Runner,
      root: ROOT,
      repo: REPO,
      mainSha: MAIN,
      headSha: HEAD,
      files,
    }),
  };
}

beforeEach(() => {
  vi.mocked(cliBuilt).mockResolvedValue(true);
  vi.mocked(validateRefusals).mockResolvedValue([]);
});

describe("hostnameClaims when the diff leaves the claims alone", () => {
  it("makes no GitHub call for a diff that changes no claim input", async () => {
    const { api, run } = check({ behindBy: 3 }, [changed(OTHER)]);
    expect(await run).toEqual({ touches: false, behindBy: 0, refusals: [] });
    expect(api).not.toHaveBeenCalled();
    expect(validateRefusals).not.toHaveBeenCalled();
  });

  it("passes a stale PR whose change keeps its hostnames, gateway and organization", async () => {
    const { run } = check(
      {
        before: { [LOGIN]: service(["login.kore.internal"], "v1") },
        after: { [LOGIN]: service(["login.kore.internal"], "v2") },
        behindBy: 2,
      },
      [changed(LOGIN)],
    );
    expect((await run).touches).toBe(false);
    expect(validateRefusals).not.toHaveBeenCalled();
  });

  it("passes a stale PR whose overlay change keeps the platform domain and Gateway", async () => {
    const { run } = check(
      {
        before: {
          [OVERLAY]: JSON.stringify({ platform: { domain: "kore.internal" } }),
        },
        after: {
          [OVERLAY]: JSON.stringify({
            platform: { domain: "kore.internal" },
            features: { "decision-advisor": false },
          }),
        },
        behindBy: 1,
      },
      [changed(OVERLAY)],
    );
    expect(await run).toEqual({ touches: false, behindBy: 1, refusals: [] });
  });
});

describe("hostnameClaims when a claim changes", () => {
  it("refuses a stale PR that touches hostnames, naming the update from main", async () => {
    const report = await check(
      {
        before: {},
        after: { [LOGIN]: service(["login.kore.internal"]) },
        behindBy: 2,
      },
      [changed(LOGIN)],
    ).run;
    expect(report.touches).toBe(true);
    expect(report.behindBy).toBe(2);
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0]).toMatch(/2 commits behind main/);
    expect(report.refusals[0]).toMatch(/update from main/);
  });

  it("passes a PR that touches hostnames when it is up to date and kore raises nothing", async () => {
    const report = await check(
      {
        before: {},
        after: { [LOGIN]: service(["login.kore.internal"]) },
        behindBy: 0,
      },
      [changed(LOGIN)],
    ).run;
    expect(report).toEqual({ touches: true, behindBy: 0, refusals: [] });
    expect(validateRefusals).toHaveBeenCalledWith(
      expect.objectContaining({ mainSha: MAIN, headSha: HEAD, root: ROOT }),
    );
  });

  it("refuses the messages kore raises on the merge, after the update remedy when stale", async () => {
    const contested =
      'infra/environments/local/services/login.json: spec.hostnames[0] "login.kore.internal" is already claimed by services/a.json';
    vi.mocked(validateRefusals).mockResolvedValue([contested]);
    const report = await check(
      {
        before: {},
        after: { [LOGIN]: service(["login.kore.internal"]) },
        behindBy: 1,
      },
      [changed(LOGIN)],
    ).run;
    expect(report.refusals).toHaveLength(2);
    expect(report.refusals[0]).toMatch(/update from main/);
    expect(report.refusals[1]).toBe(contested);
  });
});

describe("hostnameClaims on the other claim inputs", () => {
  it("treats a removed claim as a change of the hostnames", async () => {
    const report = await check(
      {
        before: { [LOGIN]: service(["login.kore.internal"]) },
        after: {},
        behindBy: 0,
      },
      [changed(LOGIN, true)],
    ).run;
    expect(report.touches).toBe(true);
  });

  it("refuses a PR that changes the platform domain of an environment", async () => {
    const report = await check(
      {
        before: {
          [OVERLAY]: JSON.stringify({ platform: { domain: "kore.internal" } }),
        },
        after: {
          [OVERLAY]: JSON.stringify({ platform: { domain: "example.com" } }),
        },
        behindBy: 1,
      },
      [changed(OVERLAY)],
    ).run;
    expect(report.touches).toBe(true);
    expect(report.refusals[0]).toMatch(/update from main/);
  });

  it("counts a claim file that is not JSON as a change, since its claims cannot be read", async () => {
    const report = await check(
      { before: {}, after: { [LOGIN]: "{ not json" }, behindBy: 0 },
      [changed(LOGIN)],
    ).run;
    expect(report.touches).toBe(true);
  });

  it("reads the catalog namespaces as claim inputs", async () => {
    const report = await check(
      {
        before: { [CATALOG_PATH]: JSON.stringify({ components: [] }) },
        after: {
          [CATALOG_PATH]: JSON.stringify({
            components: [{ name: "x", namespace: "x" }],
          }),
        },
        behindBy: 0,
      },
      [changed(CATALOG_PATH)],
    ).run;
    expect(report.touches).toBe(true);
  });
});

describe("hostnameClaims without the built kore CLI or a merge base", () => {
  it("refuses a touching PR, naming the build, when the CLI is not built", async () => {
    vi.mocked(cliBuilt).mockResolvedValue(false);
    const report = await check(
      {
        before: {},
        after: { [LOGIN]: service(["login.kore.internal"]) },
        behindBy: 0,
      },
      [changed(LOGIN)],
    ).run;
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0]).toMatch(/npm run build in tools\/kore/);
    expect(validateRefusals).not.toHaveBeenCalled();
  });

  it("names the build and the update, both, for a stale PR on a machine without the CLI", async () => {
    vi.mocked(cliBuilt).mockResolvedValue(false);
    const report = await check(
      {
        before: {},
        after: { [LOGIN]: service(["login.kore.internal"]) },
        behindBy: 3,
      },
      [changed(LOGIN)],
    ).run;
    expect(report.refusals).toHaveLength(2);
    expect(report.refusals[0]).toMatch(/3 commits behind main/);
    expect(report.refusals[1]).toMatch(/npm run build/);
  });

  it("throws when gh api names no merge base, rather than comparing against nothing", async () => {
    await expect(
      check({ before: {}, after: {}, behindBy: 0, noMergeBase: true }, [
        changed(LOGIN),
      ]).run,
    ).rejects.toThrow(JudgeError);
  });
});

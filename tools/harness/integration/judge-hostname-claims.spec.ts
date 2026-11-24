import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hostnameClaims, type ChangedFile } from "../src/judge/index.js";
import { ProcessRunner } from "../src/runtime/index.js";
import { cleanGitEnv } from "../src/testing/index.js";

// The judge's hostname claims over a real repository. A local origin holds the tracked files
// of this checkout plus the commits that make each scenario; a judge checkout clones it with
// the built kore CLI, and kore validate runs for real. The spec runs only when the CLI is
// built (tools/kore: npm run build), so an ordinary run skips it.

const REPO = "corekraft/kore";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const built = existsSync(join(repoRoot, "tools/kore/dist/src/cli/cli.js"));

const git = (cwd: string, args: readonly string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=claims",
      "-c",
      "user.email=claims@example.invalid",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanGitEnv(),
    },
  ).trim();

const LOGIN = "infra/environments/local/services/login.json";
const PORTAL = "infra/environments/local/services/portal.json";
const SHOP = "infra/environments/local/services/shop.json";

/** A Service record kore validate accepts, with its hostnames and a frontend CPU request. */
const service = (name: string, hostnames: string[], cpu = "100m") =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name },
    spec: {
      organization: "platform",
      environments: ["local"],
      components: {
        frontend: { resources: { requests: { cpu, memory: "64Mi" } } },
      },
      hostnames,
    },
  });

/** Writes files into a checkout, commits them, and returns the commit. */
function commit(dir: string, files: Record<string, string>, message: string) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

/** A local origin holding this checkout's tracked files and the commits the scenarios name. */
async function originOf() {
  const origin = await mkdtemp(join(tmpdir(), "claims-origin-"));
  const tracked = git(repoRoot, ["ls-files"]).split("\n").filter(Boolean);
  for (const path of tracked) {
    await mkdir(dirname(join(origin, path)), { recursive: true });
    await cp(join(repoRoot, path), join(origin, path));
  }
  git(origin, ["init", "-q", "-b", "main"]);
  git(origin, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "-m", "base"]);
  const base = git(origin, ["rev-parse", "HEAD"]);
  const withA = commit(
    origin,
    { [LOGIN]: service("login", ["login.kore.internal"]) },
    "a",
  );
  const onto = (name: string, from: string, files: Record<string, string>) => {
    git(origin, ["checkout", "-q", "-b", name, from]);
    return commit(origin, files, name);
  };
  const shas = {
    base,
    withA,
    prA: onto("pr-a", base, {
      [LOGIN]: service("login", ["login.kore.internal"]),
    }),
    prB: onto("pr-b", base, {
      [PORTAL]: service("portal", ["login.kore.internal"]),
    }),
    prC: onto("pr-c", base, {
      [SHOP]: service("shop", ["shop.kore.internal"]),
    }),
    prCAfter: onto("pr-c-after", withA, {
      [SHOP]: service("shop", ["shop.kore.internal"]),
    }),
    prImage: onto("pr-image", withA, {
      [LOGIN]: service("login", ["login.kore.internal"], "200m"),
    }),
  };
  git(origin, ["checkout", "-q", "main"]);
  return { origin, shas };
}

/** The judge's checkout of the origin, with the built CLI and main one commit past withA. */
async function judgeOf(origin: string) {
  const mainLater = commit(
    origin,
    { "infra/environments/local/notes.txt": "later\n" },
    "later",
  );
  const judge = await mkdtemp(join(tmpdir(), "claims-judge-"));
  git(judge, ["clone", "-q", `file://${origin}`, "."]);
  await cp(join(repoRoot, "tools/kore/dist"), join(judge, "tools/kore/dist"), {
    recursive: true,
  });
  return { judge, mainLater };
}

/** The origin's commits the scenarios name, and the judge's checkout of it. */
async function fixture() {
  const { origin, shas } = await originOf();
  const { judge, mainLater } = await judgeOf(origin);
  return { origin, judge, shas: { ...shas, mainLater } };
}

/** gh api answered by the origin: compare by merge base and count, contents by commit. */
function apiOver(origin: string) {
  return async (args: readonly string[]) => {
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const rest = endpoint.slice(`repos/${REPO}/`.length);
    const compare = /^compare\/([^.]+)\.\.\.(.+)$/.exec(rest);
    if (compare) {
      const main = compare[1] ?? "";
      const head = compare[2] ?? "";
      return JSON.stringify({
        behind_by: Number(
          git(origin, ["rev-list", "--count", `${head}..${main}`]),
        ),
        merge_base_commit: { sha: git(origin, ["merge-base", main, head]) },
      });
    }
    const contents = /^contents\/([^?]+)\?ref=(.+)$/.exec(rest);
    if (!contents) {
      throw new Error(`unexpected call ${endpoint}`);
    }
    try {
      return git(origin, ["show", `${contents[2]}:${contents[1]}`]);
    } catch {
      throw new Error("gh api failed: gh: Not Found (HTTP 404)");
    }
  };
}

const changed = (path: string): ChangedFile => ({
  path,
  previousPath: path,
  deleted: false,
  added: [],
  addedLines: [],
  removed: 0,
  netRemoved: 0,
  after: [],
  trail: [],
});

describe.skipIf(!built)("the hostname claims over a real repository", () => {
  it("passes the first claim of a name while main is where the pull request began", async () => {
    const { origin, judge, shas } = await fixture();
    const report = await hostnameClaims({
      api: apiOver(origin),
      runner: new ProcessRunner(),
      root: judge,
      repo: REPO,
      mainSha: shas.base,
      headSha: shas.prA,
      files: [changed(LOGIN)],
    });
    expect(report).toEqual({ touches: true, behindBy: 0, refusals: [] });
  }, 120_000);

  it("refuses the second claim of the same name after the first merges, naming the holder and the update", async () => {
    const { origin, judge, shas } = await fixture();
    const report = await hostnameClaims({
      api: apiOver(origin),
      runner: new ProcessRunner(),
      root: judge,
      repo: REPO,
      mainSha: shas.withA,
      headSha: shas.prB,
      files: [changed(PORTAL)],
    });
    expect(report.touches).toBe(true);
    expect(report.refusals.some((r) => r.includes("update from main"))).toBe(
      true,
    );
    expect(
      report.refusals.some((r) =>
        r.includes(
          `${PORTAL}: spec.hostnames[0] "login.kore.internal" is already claimed by ${LOGIN}`,
        ),
      ),
    ).toBe(true);
  }, 120_000);
});

describe.skipIf(!built)(
  "the hostname claims of a stale PR over a real repository",
  () => {
    it("refuses a stale PR with distinct claims until it is brought up to date, then passes", async () => {
      const { origin, judge, shas } = await fixture();
      const stale = await hostnameClaims({
        api: apiOver(origin),
        runner: new ProcessRunner(),
        root: judge,
        repo: REPO,
        mainSha: shas.withA,
        headSha: shas.prC,
        files: [changed(SHOP)],
      });
      expect(stale.refusals).toHaveLength(1);
      expect(stale.refusals[0]).toMatch(/1 commit behind main/);
      expect(stale.refusals[0]).toMatch(/update from main/);
      const updated = await hostnameClaims({
        api: apiOver(origin),
        runner: new ProcessRunner(),
        root: judge,
        repo: REPO,
        mainSha: shas.withA,
        headSha: shas.prCAfter,
        files: [changed(SHOP)],
      });
      expect(updated).toEqual({ touches: true, behindBy: 0, refusals: [] });
    }, 240_000);

    it("passes a stale PR that changes no claim", async () => {
      const { origin, judge, shas } = await fixture();
      const report = await hostnameClaims({
        api: apiOver(origin),
        runner: new ProcessRunner(),
        root: judge,
        repo: REPO,
        mainSha: shas.mainLater,
        headSha: shas.prImage,
        files: [changed(LOGIN)],
      });
      expect(report).toEqual({ touches: false, behindBy: 1, refusals: [] });
    }, 120_000);

    it("names the CLI to build when the judge's checkout has none", async () => {
      const { origin, judge, shas } = await fixture();
      await rm(join(judge, "tools/kore/dist"), {
        recursive: true,
        force: true,
      });
      const report = await hostnameClaims({
        api: apiOver(origin),
        runner: new ProcessRunner(),
        root: judge,
        repo: REPO,
        mainSha: shas.base,
        headSha: shas.prA,
        files: [changed(LOGIN)],
      });
      expect(report.refusals[0]).toMatch(/npm run build in tools\/kore/);
    }, 120_000);
  },
);

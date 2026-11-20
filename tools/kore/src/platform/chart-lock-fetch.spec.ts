// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md (the main chart lock and its artifact)
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { fetchMainChartLock } from "./chart-lock-fetch.js";

vi.mock("node:fs/promises");

const sha = "2f3534a7bf402e3a847e5e9597fc59a4986266bc";
const artifactName = `platform-charts.lock.json-${sha}`;
const runId = 44700515288;
const scratch = "/scratch/kore-chart-lock-x";
const root = "/checkout";
const output = "charts/platform-charts.lock.json";

type Reply = string | Error;

/**
 * A runner that answers each command by its full line and fails the test on
 * any other call, so a spec asserts every command the unit runs, in order.
 */
function scripted(replies: Record<string, Reply>) {
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    const key = [command, ...args].join(" ");
    const reply = replies[key];
    if (reply === undefined) {
      throw new Error(`unexpected command: ${key}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  return { runner: { run } as unknown as Runner, run };
}

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: artifactName,
  expired: false,
  created_at: "2026-11-20T08:13:39Z",
  expires_at: "2026-12-20T08:13:38Z",
  workflow_run: { id: runId },
  ...overrides,
});
const listing = (...artifacts: unknown[]) =>
  JSON.stringify({ total_count: artifacts.length, artifacts });

/** The program a failed rev-parse names; a constant, since the spec only builds the error. */
const revParse = "git";
const head = `git rev-parse --verify --quiet HEAD^{commit}`;
const list = `gh api repos/{owner}/{repo}/actions/artifacts?name=${artifactName}`;
const download = `gh run download ${runId} --name ${artifactName} --dir ${scratch}`;
const auth = "gh auth status";

/** The commands run, as full lines, in order. */
const lines = (run: ReturnType<typeof scripted>["run"]) =>
  run.mock.calls.map(([command, args]) => [command, ...args].join(" "));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mkdtemp).mockResolvedValue(scratch);
  vi.mocked(copyFile).mockResolvedValue(undefined);
  vi.mocked(rm).mockResolvedValue(undefined);
});

test("the lock for the checkout's HEAD is written to the named path, and the result names its commit, artifact and run", async () => {
  const { runner, run } = scripted({
    [head]: `${sha}\n`,
    [auth]: "",
    [list]: listing(artifact()),
    [download]: "",
  });
  expect(await fetchMainChartLock(runner, { root, output })).toEqual({
    commit: sha,
    path: output,
    artifact: artifactName,
    runId,
  });
  expect(lines(run)).toEqual([head, auth, list, download]);
  expect(run).toHaveBeenNthCalledWith(1, "git", expect.anything(), {
    cwd: root,
    capture: true,
  });
  expect(copyFile).toHaveBeenCalledWith(
    "/scratch/kore-chart-lock-x/platform-charts.lock.json",
    output,
  );
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("a --commit names that commit's artifact by its full sha, and the checkout's HEAD is not read", async () => {
  const short = "2f3534a";
  const { runner, run } = scripted({
    [`git rev-parse --verify --quiet ${short}^{commit}`]: `${sha}\n`,
    [auth]: "",
    [list]: listing(artifact()),
    [download]: "",
  });
  const lock = await fetchMainChartLock(runner, {
    root,
    commit: short,
    output,
  });
  expect(lock.commit).toBe(sha);
  expect(lines(run)).toEqual([
    `git rev-parse --verify --quiet ${short}^{commit}`,
    auth,
    list,
    download,
  ]);
});

test("the newest unexpired artifact is downloaded when an earlier attempt for the same commit expired", async () => {
  const { runner, run } = scripted({
    [head]: `${sha}\n`,
    [auth]: "",
    [list]: listing(
      artifact({
        id: 1,
        expired: true,
        created_at: "2026-11-01T00:00:00Z",
        workflow_run: { id: 10 },
      }),
      artifact({
        id: 2,
        created_at: "2026-11-20T00:00:00Z",
        workflow_run: { id: 77 },
      }),
    ),
    [`gh run download 77 --name ${artifactName} --dir ${scratch}`]: "",
  });
  expect(await fetchMainChartLock(runner, { root, output })).toEqual({
    commit: sha,
    path: output,
    artifact: artifactName,
    runId: 77,
  });
  expect(lines(run).at(-1)).toBe(
    `gh run download 77 --name ${artifactName} --dir ${scratch}`,
  );
});

test("a commit with no charts-main artifact fails naming the commit, the artifact and the fix, and writes nothing", async () => {
  const { runner } = scripted({
    [head]: `${sha}\n`,
    [auth]: "",
    [list]: listing(),
  });
  await expect(fetchMainChartLock(runner, { root, output })).rejects.toThrow(
    `main chart lock: no charts-main artifact for commit ${sha} (${artifactName}); the charts-main job publishes it on each push to main, so push the commit to main, wait for its run to finish green, then rerun`,
  );
  expect(copyFile).not.toHaveBeenCalled();
});

test("an expired artifact fails naming the expiry, the run to rerun and the fix, and downloads nothing", async () => {
  const { runner, run } = scripted({
    [head]: `${sha}\n`,
    [auth]: "",
    [list]: listing(artifact({ expired: true })),
  });
  await expect(fetchMainChartLock(runner, { root, output })).rejects.toThrow(
    `main chart lock: the charts-main artifact for commit ${sha} expired on 2026-12-20T08:13:38Z; artifacts are kept 30 days. Rerun that commit's workflow run with gh run rerun ${runId}, which publishes the lock again, or fetch the lock for a newer commit on main`,
  );
  expect(lines(run).some((line) => line.startsWith("gh run download"))).toBe(
    false,
  );
  expect(copyFile).not.toHaveBeenCalled();
});

test("gh not signed in fails naming the fix, before the artifact is listed", async () => {
  const { runner, run } = scripted({
    [head]: `${sha}\n`,
    [auth]: new CommandError("gh", ["auth", "status"], {
      stdout: "",
      stderr:
        "You are not logged into any GitHub hosts. Run gh auth login to authenticate.",
      code: 1,
    }),
  });
  await expect(fetchMainChartLock(runner, { root, output })).rejects.toThrow(
    "main chart lock: gh is not signed in, so the charts-main artifact cannot be listed; run gh auth login (or set GH_TOKEN), then rerun",
  );
  expect(lines(run)).toEqual([head, auth]);
  expect(copyFile).not.toHaveBeenCalled();
});

test("a --commit that is not a commit in this checkout fails naming the ref, and lists nothing", async () => {
  const { runner, run } = scripted({
    ["git rev-parse --verify --quiet nope^{commit}"]: new CommandError(
      revParse,
      ["rev-parse", "--verify", "--quiet", "nope^{commit}"],
      { stdout: "", stderr: "", code: 1 },
    ),
  });
  await expect(
    fetchMainChartLock(runner, { root, commit: "nope", output }),
  ).rejects.toThrow(
    "main chart lock: nope is not a commit in this checkout; fetch it, or pass a commit that is here",
  );
  expect(lines(run)).toEqual(["git rev-parse --verify --quiet nope^{commit}"]);
});

test("a failed download removes its scratch directory and writes nothing to the named path", async () => {
  const { runner } = scripted({
    [head]: `${sha}\n`,
    [auth]: "",
    [list]: listing(artifact()),
    [download]: new CommandError("gh", ["run", "download"], {
      stdout: "",
      stderr: "no valid artifacts found",
      code: 1,
    }),
  });
  await expect(fetchMainChartLock(runner, { root, output })).rejects.toThrow(
    "no valid artifacts found",
  );
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
  expect(copyFile).not.toHaveBeenCalled();
});

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (immutable, content-addressed charts)
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { enabledComponents, helmInstalledComponents } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  chartLockDrift,
  chartLockDriftMessage,
  upChartLockDrift,
} from "./chart-lock-drift.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");

const repository = fakeRepository({}, "/repo");
const scratch = "/scratch/kore-chart-lock-x";
const script = "/repo/.github/scripts/package-platform-charts.sh";

const packaged = (versions: Record<string, string>) =>
  Object.entries(versions)
    .map(([name, version]) =>
      JSON.stringify({ name, version, file: `${name}-${version}.tgz` }),
    )
    .join("\n") + "\n";

const lockOf = (versions: Record<string, string | undefined>) =>
  JSON.stringify({
    version: 1,
    entries: Object.fromEntries(
      Object.entries(versions).map(([name, version]) => [
        name,
        { chart: `reg/charts/${name}`, digest: "sha256:1", version },
      ]),
    ),
  });

const checkout = (versions: Record<string, string>) =>
  fakeRunner(() => packaged(versions));

const published = {
  "opa-authorizer": "0.0.0-aaaaaaaaaaaa",
  "kore-platform-config": "0.0.0-bbbbbbbbbbbb",
};

beforeEach(() => {
  vi.mocked(helmInstalledComponents).mockReturnValue([
    fakeComponent({ name: "kore-config-delivery" }),
  ]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ name: "opa-authorizer", owner: "argocd" }),
    fakeComponent({ name: "kore-platform-config", owner: "argocd" }),
    fakeComponent({ name: "kore-config-delivery", owner: "kore" }),
    fakeComponent({ name: "kore-image-policy", owner: "kore" }),
  ]);
  vi.mocked(mkdtemp).mockResolvedValue(scratch);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(readFile).mockResolvedValue(lockOf(published));
});

test("a lock equal to the checkout reports each handed-over release with no drift, packaging with the release's own script", async () => {
  const { runner, run } = checkout(published);
  await expect(
    chartLockDrift(repository, runner, "lock.json"),
  ).resolves.toEqual([
    {
      name: "opa-authorizer",
      repository: "0.0.0-aaaaaaaaaaaa",
      lock: "0.0.0-aaaaaaaaaaaa",
      drift: false,
    },
    {
      name: "kore-platform-config",
      repository: "0.0.0-bbbbbbbbbbbb",
      lock: "0.0.0-bbbbbbbbbbbb",
      drift: false,
    },
  ]);
  expect(run).toHaveBeenCalledWith(script, [scratch], {
    cwd: "/repo",
    capture: true,
  });
  expect(readFile).toHaveBeenCalledWith("lock.json", "utf8");
});

test("a stale chart is the one row with drift, carrying the repository's and the lock's version", async () => {
  const { runner } = checkout({
    ...published,
    "kore-platform-config": "0.0.0-cccccccccccc",
  });
  const rows = await chartLockDrift(repository, runner, "lock.json");
  expect(rows.filter((row) => row.drift)).toEqual([
    {
      name: "kore-platform-config",
      repository: "0.0.0-cccccccccccc",
      lock: "0.0.0-bbbbbbbbbbbb",
      drift: true,
    },
  ]);
});

test("a release the environment does not hand over, and the image policy kore keeps, are skipped even when packaged and locked", async () => {
  vi.mocked(readFile).mockResolvedValue(
    lockOf({
      ...published,
      "kore-hostname-ownership": "0.0.0-old",
      "kore-image-policy": "0.0.0-old",
    }),
  );
  const { runner } = checkout({
    ...published,
    "kore-hostname-ownership": "0.0.0-new",
    "kore-image-policy": "0.0.0-new",
  });
  const rows = await chartLockDrift(repository, runner, "lock.json");
  expect(rows.map((row) => row.name)).toEqual([
    "opa-authorizer",
    "kore-platform-config",
  ]);
});

test("a handed-over release the packaging does not produce fails closed, naming it", async () => {
  const { runner } = checkout({
    "opa-authorizer": published["opa-authorizer"],
  });
  await expect(chartLockDrift(repository, runner, "lock.json")).rejects.toThrow(
    "platform chart lock: kore-platform-config is handed over to Argo CD but .github/scripts/package-platform-charts.sh did not package it, so its version cannot be compared; add it to the script's chart list",
  );
});

test("a handed-over release with no entry in the lock fails closed, naming it", async () => {
  vi.mocked(readFile).mockResolvedValue(
    lockOf({ "opa-authorizer": published["opa-authorizer"] }),
  );
  const { runner } = checkout(published);
  await expect(chartLockDrift(repository, runner, "lock.json")).rejects.toThrow(
    "platform chart lock: lock.json has no entry for kore-platform-config, which is handed over to Argo CD; pass the platform-charts.lock.json of a release that published it",
  );
});

test("a lock entry with no version fails closed, because it cannot be compared with the checkout", async () => {
  vi.mocked(readFile).mockResolvedValue(
    lockOf({ ...published, "opa-authorizer": undefined }),
  );
  const { runner } = checkout(published);
  await expect(chartLockDrift(repository, runner, "lock.json")).rejects.toThrow(
    "platform chart lock: lock.json has no version for opa-authorizer, so it cannot be compared with this checkout; republish the release",
  );
});

test("a lock that is not JSON is refused with its path and runs no packaging", async () => {
  vi.mocked(readFile).mockResolvedValue("{ not json");
  const { runner, run } = checkout(published);
  await expect(chartLockDrift(repository, runner, "lock.json")).rejects.toThrow(
    /^platform chart lock: lock\.json is not valid JSON: /,
  );
  expect(run).not.toHaveBeenCalled();
});

test("a lock without an entries object is refused as not a release lock, running no packaging", async () => {
  vi.mocked(readFile).mockResolvedValue('{"version":1}');
  const { runner, run } = checkout(published);
  await expect(chartLockDrift(repository, runner, "lock.json")).rejects.toThrow(
    "platform chart lock: lock.json must be {version: 1, entries: {<release>: {chart, digest, version}}}; pass the platform-charts.lock.json attached to the release",
  );
  expect(run).not.toHaveBeenCalled();
});

test("unreadable packaging output surfaces as the parse error it is, not as a packaging failure", async () => {
  const { runner } = fakeRunner(() => "not json\n");
  await expect(
    chartLockDrift(repository, runner, "lock.json"),
  ).rejects.toBeInstanceOf(SyntaxError);
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("a packaging failure names its cause and the fix, and the scratch directory is still removed", async () => {
  const runner: Runner = {
    run: vi.fn<Runner["run"]>(async () => {
      throw new Error("helm: command not found");
    }),
  };
  await expect(chartLockDrift(repository, runner, "lock.json")).rejects.toThrow(
    "platform chart lock: packaging this checkout's charts to compare them with lock.json failed: helm: command not found; install the pinned tools (mise install) and rerun",
  );
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("the scratch directory is removed after a successful comparison too", async () => {
  const { runner } = checkout(published);
  await chartLockDrift(repository, runner, "lock.json");
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("the drift message names each drifted chart with both versions and what the run would test, and the fix", () => {
  expect(
    chartLockDriftMessage(
      [
        {
          name: "kore-platform-config",
          repository: "0.0.0-new",
          lock: "0.0.0-old",
          drift: true,
        },
        {
          name: "opa-authorizer",
          repository: "0.0.0-n2",
          lock: "0.0.0-o2",
          drift: true,
        },
      ],
      "lock.json",
    ),
  ).toBe(
    [
      "platform chart lock: kore-platform-config is 0.0.0-old in lock.json but 0.0.0-new in this checkout; the published chart differs from the repository; this run would test the published chart, not the repository's. Pass the platform-charts.lock.json of a release that contains the change, or rebuild the lock with .github/scripts/package-platform-charts.sh",
      "platform chart lock: opa-authorizer is 0.0.0-o2 in lock.json but 0.0.0-n2 in this checkout; the published chart differs from the repository; this run would test the published chart, not the repository's. Pass the platform-charts.lock.json of a release that contains the change, or rebuild the lock with .github/scripts/package-platform-charts.sh",
    ].join("\n"),
  );
});

test("local up compares nothing while the delivery release is not installed, so a flag-off run never packages", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([]);
  const { runner, run } = checkout(published);
  await expect(
    upChartLockDrift(repository, runner, "lock.json"),
  ).resolves.toEqual([]);
  expect(run).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(mkdtemp).not.toHaveBeenCalled();
});

test("local up compares nothing without a lock path, since composing the delivery values already names the missing flag", async () => {
  const { runner, run } = checkout(published);
  await expect(
    upChartLockDrift(repository, runner, undefined),
  ).resolves.toEqual([]);
  expect(run).not.toHaveBeenCalled();
});

test("local up compares the lock with the checkout while the delivery release is installed", async () => {
  const { runner } = checkout({ ...published, "opa-authorizer": "0.0.0-new" });
  const rows = await upChartLockDrift(repository, runner, "lock.json");
  expect(rows.filter((row) => row.drift).map((row) => row.name)).toEqual([
    "opa-authorizer",
  ]);
});

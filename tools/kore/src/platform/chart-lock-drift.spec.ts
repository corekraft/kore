// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (immutable, content-addressed charts)
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { enabledComponents, helmInstalledComponents } from "../config/index.js";
import { assertChartLockMatchesCheckout } from "./chart-lock-drift.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");

const repository = fakeRepository({}, "/repo");
const scratch = "/scratch/kore-chart-lock-x";

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

function checkout(versions: Record<string, string>) {
  return fakeRunner(() => packaged(versions));
}

beforeEach(() => {
  vi.mocked(helmInstalledComponents).mockReturnValue([
    fakeComponent({ name: "kore-config-delivery" }),
  ]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ name: "opa-authorizer", owner: "argocd" }),
    fakeComponent({ name: "kore-platform-config", owner: "argocd" }),
    fakeComponent({ name: "kore-config-delivery", owner: "kore" }),
  ]);
  vi.mocked(mkdtemp).mockResolvedValue(scratch);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(readFile).mockResolvedValue(
    lockOf({
      "opa-authorizer": "0.0.0-aaaaaaaaaaaa",
      "kore-platform-config": "0.0.0-bbbbbbbbbbbb",
    }),
  );
});

test("a lock whose versions equal the checkout's packaged versions passes, so the run tests what the repository holds", async () => {
  const { runner, run } = checkout({
    "opa-authorizer": "0.0.0-aaaaaaaaaaaa",
    "kore-platform-config": "0.0.0-bbbbbbbbbbbb",
  });
  await expect(
    assertChartLockMatchesCheckout(repository, runner, "lock.json"),
  ).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledWith(
    "/repo/.github/scripts/package-platform-charts.sh",
    [scratch],
    { cwd: "/repo", capture: true },
  );
  expect(readFile).toHaveBeenCalledWith("lock.json", "utf8");
});

test("a chart whose published version differs from the checkout's fails naming the chart, both versions and the consequence", async () => {
  const { runner } = checkout({
    "opa-authorizer": "0.0.0-aaaaaaaaaaaa",
    "kore-platform-config": "0.0.0-cccccccccccc",
  });
  await expect(
    assertChartLockMatchesCheckout(repository, runner, "lock.json"),
  ).rejects.toThrow(
    "platform chart lock: kore-platform-config is 0.0.0-bbbbbbbbbbbb in lock.json but 0.0.0-cccccccccccc in this checkout; the published chart differs from the repository; the run would not test your change. Pass the platform-charts.lock.json of a release cut from this commit, or rebuild the lock with .github/scripts/package-platform-charts.sh",
  );
});

test("every drifting chart is named in one error, so one rerun fixes them all", async () => {
  const { runner } = checkout({
    "opa-authorizer": "0.0.0-111111111111",
    "kore-platform-config": "0.0.0-222222222222",
  });
  const error = await assertChartLockMatchesCheckout(
    repository,
    runner,
    "lock.json",
  ).catch((caught: Error) => caught);
  expect((error as Error).message.split("\n")).toHaveLength(2);
  expect((error as Error).message).toContain("opa-authorizer is");
  expect((error as Error).message).toContain("kore-platform-config is");
});

test("a lock entry with no version fails, because it cannot be compared with the checkout", async () => {
  vi.mocked(readFile).mockResolvedValue(
    lockOf({ "opa-authorizer": undefined, "kore-platform-config": "0.0.0-b" }),
  );
  const { runner } = checkout({
    "opa-authorizer": "0.0.0-a",
    "kore-platform-config": "0.0.0-b",
  });
  await expect(
    assertChartLockMatchesCheckout(repository, runner, "lock.json"),
  ).rejects.toThrow(
    "platform chart lock: opa-authorizer has no version in lock.json, so it cannot be compared with this checkout; republish the release",
  );
});

test("a chart the release does not hand over is not compared, so a flag-off chart's drift never blocks the run", async () => {
  vi.mocked(readFile).mockResolvedValue(
    lockOf({
      "opa-authorizer": "0.0.0-a",
      "kore-platform-config": "0.0.0-b",
      "kore-hostname-ownership": "0.0.0-old",
    }),
  );
  const { runner } = checkout({
    "opa-authorizer": "0.0.0-a",
    "kore-platform-config": "0.0.0-b",
    "kore-hostname-ownership": "0.0.0-new",
  });
  await expect(
    assertChartLockMatchesCheckout(repository, runner, "lock.json"),
  ).resolves.toBeUndefined();
});

test("the scratch directory is removed whether the comparison passes or fails", async () => {
  const { runner } = checkout({
    "opa-authorizer": "0.0.0-zzzzzzzzzzzz",
    "kore-platform-config": "0.0.0-bbbbbbbbbbbb",
  });
  await assertChartLockMatchesCheckout(repository, runner, "lock.json").catch(
    () => undefined,
  );
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("a packaging failure is reported with its cause and still removes the scratch directory", async () => {
  const runner: Runner = {
    run: vi.fn<Runner["run"]>(async () => {
      throw new Error("helm: command not found");
    }),
  };
  await expect(
    assertChartLockMatchesCheckout(repository, runner, "lock.json"),
  ).rejects.toThrow(
    "platform chart lock: packaging this checkout's charts to compare them with lock.json failed: helm: command not found; install the pinned tools (mise install) and rerun",
  );
  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("with the delivery release not installed nothing is packaged or read, so a flag-off run stays free of the check", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([]);
  const { runner, run } = checkout({});
  await expect(
    assertChartLockMatchesCheckout(repository, runner, "lock.json"),
  ).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(mkdtemp).not.toHaveBeenCalled();
});

test("without a lock path nothing is packaged, since composing the delivery values already names the missing flag", async () => {
  const { runner, run } = checkout({});
  await expect(
    assertChartLockMatchesCheckout(repository, runner, undefined),
  ).resolves.toBeUndefined();
  expect(run).not.toHaveBeenCalled();
});

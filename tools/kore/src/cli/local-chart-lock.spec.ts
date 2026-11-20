import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ChartPackagingError,
  chartLockDrift,
  chartLockDriftMessage,
  composeChartDelivery,
  composeGoldenPathDelivery,
  fetchMainChartLock,
  upChartLockDrift,
} from "../platform/index.js";
import { boolFlag, stringFlag } from "./flags.js";
import { print } from "./output.js";
import {
  fakeContext,
  fakeRepository,
  parsedArgs,
  sharedRunner,
} from "./cli-support.js";
import {
  composeLocalDelivery,
  fetchChartLock,
  lockCheck,
} from "./local-chart-lock.js";

vi.mock("../platform/index.js", () => ({
  ChartPackagingError: class extends Error {},
  chartLockDrift: vi.fn(),
  chartLockDriftMessage: vi.fn(),
  composeChartDelivery: vi.fn(),
  composeGoldenPathDelivery: vi.fn(),
  upChartLockDrift: vi.fn(),
  fetchMainChartLock: vi.fn(),
}));
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository();
const charts = fakeRepository({ gateway: { name: "charts" } });
const delivered = fakeRepository({ gateway: { name: "delivered" } });
const runner = sharedRunner;
const row = {
  name: "opa-authorizer",
  repository: "0.0.0-a",
  lock: "0.0.0-a",
  drift: false,
};
const stale = {
  name: "kore-platform-config",
  repository: "0.0.0-new",
  lock: "0.0.0-old",
  drift: true,
};

let stderr: ReturnType<typeof vi.spyOn>;

/** `local up` with the named standalone flags set and both locks given. */
function up(...flags: string[]) {
  vi.mocked(boolFlag).mockImplementation((_parsed, name) =>
    flags.includes(name),
  );
  vi.mocked(stringFlag).mockImplementation(
    (_parsed, name) =>
      ({
        "platform-chart-lock": "charts.json",
        "platform-template-lock": "templates.json",
      })[name],
  );
  return composeLocalDelivery(
    fakeContext({ command: "local", action: "up", repository }),
    runner,
  );
}

beforeEach(() => {
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(chartLockDriftMessage).mockReturnValue(
    "drift: kore-platform-config",
  );
  vi.mocked(composeChartDelivery).mockResolvedValue(charts);
  vi.mocked(composeGoldenPathDelivery).mockResolvedValue(delivered);
  vi.mocked(upChartLockDrift).mockResolvedValue([row]);
});

afterEach(() => {
  stderr.mockRestore();
});

test("both locks are composed in order, the chart lock compared with the checkout between them, and the golden-path result is what comes up", async () => {
  expect(await up()).toBe(delivered);
  expect(composeChartDelivery).toHaveBeenCalledWith(repository, "charts.json");
  expect(upChartLockDrift).toHaveBeenCalledWith(
    repository,
    runner,
    "charts.json",
  );
  expect(composeGoldenPathDelivery).toHaveBeenCalledWith(
    charts,
    runner,
    "templates.json",
  );
  expect(stderr).not.toHaveBeenCalled();
});

test("a chart lock that differs from the checkout is a warning by default, since running ahead of the last release is normal outside a proof", async () => {
  vi.mocked(upChartLockDrift).mockResolvedValue([stale]);
  expect(await up()).toBe(delivered);
  expect(chartLockDriftMessage).toHaveBeenCalledWith([stale], "charts.json");
  expect(stderr).toHaveBeenCalledWith("warning: drift: kore-platform-config\n");
});

test("--require-fresh-lock refuses a differing chart lock, naming the drift, before the template lock is read and with no warning", async () => {
  vi.mocked(upChartLockDrift).mockResolvedValue([stale]);
  await expect(up("require-fresh-lock")).rejects.toThrow(
    "drift: kore-platform-config",
  );
  expect(composeGoldenPathDelivery).not.toHaveBeenCalled();
  expect(stderr).not.toHaveBeenCalled();
});

test("--require-fresh-lock with a matching chart lock passes quietly", async () => {
  expect(await up("require-fresh-lock")).toBe(delivered);
  expect(stderr).not.toHaveBeenCalled();
});

test("a packaging failure is a warning by default, since the check could not run, and a refusal under --require-fresh-lock", async () => {
  vi.mocked(upChartLockDrift).mockRejectedValue(
    new ChartPackagingError("no helm"),
  );
  expect(await up()).toBe(delivered);
  expect(stderr).toHaveBeenCalledWith(
    "warning: the chart lock was not compared with the checkout: no helm\n",
  );
  await expect(up("require-fresh-lock")).rejects.toThrow("no helm");
});

test("any other failure of the check is refused even by default, since it names a lock or tooling problem and not a missing run", async () => {
  vi.mocked(upChartLockDrift).mockRejectedValue(
    new Error("lock.json has no entry for opa-authorizer"),
  );
  await expect(up()).rejects.toThrow(
    "lock.json has no entry for opa-authorizer",
  );
  expect(composeGoldenPathDelivery).not.toHaveBeenCalled();
  expect(stderr).not.toHaveBeenCalled();
});

test("--require-fresh-lock without a chart lock refuses, since nothing would be compared", async () => {
  vi.mocked(boolFlag).mockReturnValue(true);
  vi.mocked(stringFlag).mockReturnValue(undefined);
  await expect(
    composeLocalDelivery(
      fakeContext({ command: "local", action: "up", repository }),
      runner,
    ),
  ).rejects.toThrow(
    "--require-fresh-lock needs --platform-chart-lock <platform-charts.lock.json>, the lock the proof will install from",
  );
  expect(upChartLockDrift).not.toHaveBeenCalled();
});

test("a lock that fails its own schema check stops before the checkout is compared", async () => {
  vi.mocked(composeChartDelivery).mockRejectedValue(new Error("bad lock"));
  await expect(up()).rejects.toThrow("bad lock");
  expect(upChartLockDrift).not.toHaveBeenCalled();
});

function withLock(json: boolean) {
  vi.mocked(stringFlag).mockReturnValue("charts.json");
  return fakeContext({
    command: "local",
    action: "lock-check",
    repository,
    json,
  });
}

test("lock-check reports one row per release with a verdict naming the drifted chart, and returns 1", async () => {
  vi.mocked(chartLockDrift).mockResolvedValue([stale, row]);
  expect(await lockCheck(withLock(true))).toBe(1);
  expect(chartLockDrift).toHaveBeenCalledWith(
    repository,
    runner,
    "charts.json",
  );
  expect(print).toHaveBeenCalledWith(
    {
      verdict:
        "drift in kore-platform-config: this run would test the published chart, not the repository's; the fix is a release or a main publish that contains the change",
      releases: [stale, row],
    },
    true,
  );
});

test("lock-check returns 0 and says the lock matches when no release drifts", async () => {
  vi.mocked(chartLockDrift).mockResolvedValue([row]);
  expect(await lockCheck(withLock(false))).toBe(0);
  expect(print).toHaveBeenCalledWith(
    {
      verdict: "no drift: the chart lock matches this checkout for 1 release",
      releases: [row],
    },
    false,
  );
});

test("lock-check without a chart lock names the flag and compares nothing", async () => {
  vi.mocked(stringFlag).mockReturnValue(undefined);
  await expect(
    lockCheck(
      fakeContext({ command: "local", action: "lock-check", repository }),
    ),
  ).rejects.toThrow(
    "kore local lock-check needs --platform-chart-lock <platform-charts.lock.json>, the release asset published with the charts",
  );
  expect(chartLockDrift).not.toHaveBeenCalled();
});

const sha = "2f3534a7bf402e3a847e5e9597fc59a4986266bc";
const mainLock = {
  commit: sha,
  path: "charts.json",
  artifact: `platform-charts.lock.json-${sha}`,
  runId: 44700515288,
};

/** `local fetch-lock` with the given parsed flags; read-only, so no lock or journal. */
function fetchContext(parsed = parsedArgs(), json = false) {
  return fakeContext({
    command: "local",
    action: "fetch-lock",
    repository,
    parsed,
    json,
  });
}

test("fetch-lock writes the main chart lock of the checkout's HEAD to the named path, and prints its commit and path", async () => {
  vi.mocked(stringFlag).mockImplementation(
    (_parsed, name) => ({ output: "charts.json" })[name],
  );
  vi.mocked(fetchMainChartLock).mockResolvedValue(mainLock);
  expect(await fetchChartLock(fetchContext())).toBe(0);
  expect(fetchMainChartLock).toHaveBeenCalledWith(runner, {
    root: "/repo",
    commit: undefined,
    output: "charts.json",
  });
  expect(print).toHaveBeenCalledWith(
    { status: "fetched", commit: sha, path: "charts.json" },
    false,
  );
});

test("fetch-lock with --commit fetches that commit's lock, and prints the same object as JSON when asked", async () => {
  vi.mocked(stringFlag).mockImplementation(
    (_parsed, name) => ({ output: "charts.json", commit: "2f3534a" })[name],
  );
  vi.mocked(fetchMainChartLock).mockResolvedValue(mainLock);
  expect(
    await fetchChartLock(fetchContext(parsedArgs({ commit: "2f3534a" }), true)),
  ).toBe(0);
  expect(fetchMainChartLock).toHaveBeenCalledWith(runner, {
    root: "/repo",
    commit: "2f3534a",
    output: "charts.json",
  });
  expect(print).toHaveBeenCalledWith(
    { status: "fetched", commit: sha, path: "charts.json" },
    true,
  );
});

test("fetch-lock without --output names the flag and fetches nothing", async () => {
  vi.mocked(stringFlag).mockReturnValue(undefined);
  await expect(fetchChartLock(fetchContext())).rejects.toThrow(
    "kore local fetch-lock needs --output <platform-charts.lock.json>, the path the lock is written to",
  );
  expect(fetchMainChartLock).not.toHaveBeenCalled();
});

test("fetch-lock with a bare --commit refuses, rather than fetching the checkout's HEAD by mistake", async () => {
  vi.mocked(stringFlag).mockImplementation(
    (_parsed, name) => ({ output: "charts.json" })[name],
  );
  await expect(
    fetchChartLock(fetchContext(parsedArgs({ commit: true }))),
  ).rejects.toThrow(
    "kore local fetch-lock --commit needs the sha of the commit whose lock to fetch; omit --commit for the checkout's HEAD",
  );
  expect(fetchMainChartLock).not.toHaveBeenCalled();
});

import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";
import {
  GoldenPathScaleCheck,
  type ScaleCheckDeps,
  type ScaleCheckOptions,
} from "./golden-path-scale-check.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { countRound, loadArgs } from "./route-load.js";

vi.mock("./route-load.js", () => ({ countRound: vi.fn(), loadArgs: vi.fn() }));
vi.mock("./golden-path-routes.js", () => ({
  goldenPathRouteSet: {
    name: "golden-path",
    routes: [
      { path: "/", status: 200 },
      { path: "/api", status: 404 },
    ],
  },
}));

const options: ScaleCheckOptions = {
  kubeContext: "k3d-kore-local",
  namespace: "golden-path-example--local",
  deployment: "golden-path-example-bff",
  peakReplicas: 4,
  hostname: "golden-path-example.platform.kore.local",
  port: 8443,
  caRoot: "/ca",
  requestsPerRoute: 50,
  concurrency: 4,
  maxLoadAverage: 10,
  maxPolls: 5,
  pollIntervalSeconds: 5,
};
const BEFORE = { load: { oneMinute: 1 } } as unknown as HostSnapshot;
const AFTER = { load: { oneMinute: 2 } } as unknown as HostSnapshot;

/**
 * A deployment that moves one ready replica per read towards the replica count
 * last scaled to. `stuckAt` stops it short, as a sync that reverts the scale would.
 */
/** `scaled` names the Deployments the autoscalers target; `[]` is a chart with none. */
function cluster(
  initial: number,
  stuckAt?: number,
  scaled = [options.deployment],
) {
  const state = { desired: initial, ready: initial };
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const scale = args.find((arg) => arg.startsWith("--replicas="));
    if (scale !== undefined) {
      state.desired = Number(scale.slice("--replicas=".length));
      return { stdout: "", stderr: "", code: 0 };
    }
    if (args.includes("hpa")) {
      const items = scaled.map((name) => ({
        spec: { scaleTargetRef: { kind: "Deployment", name } },
      }));
      return { stdout: JSON.stringify({ items }), stderr: "", code: 0 };
    }
    const target = Math.min(state.desired, stuckAt ?? state.desired);
    state.ready += Math.sign(target - state.ready);
    return {
      stdout: JSON.stringify({
        spec: { replicas: state.desired },
        status: { replicas: state.ready, readyReplicas: state.ready },
      }),
      stderr: "",
      code: 0,
    };
  });
  return { state, runner: { run } satisfies Runner };
}

const scales = (runner: ReturnType<typeof cluster>["runner"]): number[] =>
  runner.run.mock.calls
    .map(([, args]) => args.find((arg) => arg.startsWith("--replicas=")))
    .filter((arg): arg is string => arg !== undefined)
    .map((arg) => Number(arg.slice("--replicas=".length)));

function check(
  runner: Runner,
  overrides: Partial<ScaleCheckOptions> = {},
  load: Runner["run"] = async () => ({ stdout: "ok\n", stderr: "", code: 0 }),
  loadAverage = 1,
  host?: HostReader,
) {
  const loadRunner = { run: vi.fn<Runner["run"]>(load) } satisfies Runner;
  let clock = 0;
  const deps: ScaleCheckDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async (seconds) => {
      clock += seconds * 1000;
    }),
    loadAverage: vi.fn(() => loadAverage),
    now: vi.fn(() => clock),
  };
  return {
    loadRunner,
    deps,
    scaleCheck: new GoldenPathScaleCheck(
      runner,
      loadRunner,
      { ...options, ...overrides },
      deps,
      host,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadArgs).mockImplementation((_target, path) => ["curl", path]);
  vi.mocked(countRound).mockImplementation((route, stdout, sent) => {
    if (stdout === "bad\n") {
      throw new Error(
        `route ${route.path} answered 503 for 1 of ${sent} requests, expected ${route.status}`,
      );
    }
    return sent;
  });
});

test("scales the BFF out to the peak and back to its starting count, recording both counts", async () => {
  const { runner } = cluster(2);

  const result = await check(runner).scaleCheck.run();

  expect(scales(runner)).toEqual([2, 4, 2]);
  expect(result.replicas).toEqual({
    start: 2,
    requestedPeak: 4,
    peak: 4,
    end: 2,
  });
});

test("sets the starting count it was given, records it, and puts back the count it found", async () => {
  const { runner, state } = cluster(2);

  const result = await check(runner, { startReplicas: 1 }).scaleCheck.run();

  expect(scales(runner)).toEqual([1, 4, 1, 2]);
  expect(result.replicas.start).toBe(1);
  expect(state.desired).toBe(2);
});

test("a failed request puts back the count it found, not the starting count it was given", async () => {
  const { runner, state } = cluster(3);
  const { scaleCheck } = check(runner, { startReplicas: 1 }, async () => ({
    stdout: "bad\n",
    stderr: "",
    code: 0,
  }));

  await expect(scaleCheck.run()).rejects.toThrow("a request failed");

  expect(state.desired).toBe(3);
});

test("a later kubectl failure after a failed request still scales back, and the request failure is the error reported", async () => {
  const { state, runner } = cluster(2);
  const failing = {
    run: vi.fn<Runner["run"]>(async (command, args, runOptions) => {
      if (args.includes("get") && state.desired === 4) {
        throw new Error("kubectl get failed");
      }
      return runner.run(command, args, runOptions);
    }),
  } satisfies Runner;
  const { scaleCheck } = check(failing, {}, async () => ({
    stdout: "bad\n",
    stderr: "",
    code: 0,
  }));

  await expect(scaleCheck.run()).rejects.toThrow(
    "a request failed during the scale check of golden-path-example--local/golden-path-example-bff: route / answered 503 for 1 of 50 requests, expected 200",
  );

  expect(state.desired).toBe(2);
});

test("a restore that fails is named beside the original failure and never replaces it", async () => {
  const { runner } = cluster(2);
  let scaled = 0;
  const failing = {
    run: vi.fn<Runner["run"]>(async (command, args, runOptions) => {
      if (args.some((arg) => arg.startsWith("--replicas=")) && ++scaled > 2) {
        throw new Error("the API server is gone");
      }
      return runner.run(command, args, runOptions);
    }),
  } satisfies Runner;
  const { scaleCheck } = check(failing, {}, async () => ({
    stdout: "bad\n",
    stderr: "",
    code: 0,
  }));

  await expect(scaleCheck.run()).rejects.toThrow(
    new Error(
      "a request failed during the scale check of golden-path-example--local/golden-path-example-bff: route / answered 503 for 1 of 50 requests, expected 200; restoring golden-path-example--local/golden-path-example-bff to 2 replicas also failed: the API server is gone; scale it back by hand",
    ),
  );
});

test("addresses the configured context, namespace and deployment, never the current context", async () => {
  const { runner } = cluster(2);

  await check(runner).scaleCheck.run();

  for (const [command, args] of runner.run.mock.calls) {
    expect(command).toBe("kubectl");
    expect(args.slice(0, 4)).toEqual([
      "--context",
      "k3d-kore-local",
      "--namespace",
      "golden-path-example--local",
    ]);
  }
  expect(runner.run.mock.calls[0]?.[1]).toEqual([
    "--context",
    "k3d-kore-local",
    "--namespace",
    "golden-path-example--local",
    "get",
    "deployment",
    "golden-path-example-bff",
    "--output",
    "json",
  ]);
});

test("sends the golden-path load throughout and reports the requests, none failed, under the golden-path route set", async () => {
  const { runner } = cluster(2);
  const { scaleCheck, loadRunner } = check(runner);

  const result = await scaleCheck.run();

  const sent = loadRunner.run.mock.calls.length;
  expect(sent).toBeGreaterThan(0);
  expect(result.load.requests).toBe(sent * 50);
  expect(result.load.failedRequests).toBe(0);
  expect(result.method.routeSet).toBe(goldenPathRouteSet.name);
  expect(result.method.routes).toEqual(["/", "/api"]);
  expect(vi.mocked(loadArgs).mock.calls.map(([, path]) => path)).toContain(
    "/api",
  );
});

test("a failed request during the scale fails the check naming the route and the status", async () => {
  const { runner } = cluster(2);
  let rounds = 0;
  const { scaleCheck } = check(runner, {}, async () => ({
    stdout: ++rounds > 2 ? "bad\n" : "ok\n",
    stderr: "",
    code: 0,
  }));

  await expect(scaleCheck.run()).rejects.toThrow(
    "a request failed during the scale check of golden-path-example--local/golden-path-example-bff: route / answered 503 for 1 of 50 requests, expected 200",
  );
});

test("a failed request still scales the BFF back to its starting count", async () => {
  const { runner, state } = cluster(2);
  const { scaleCheck } = check(runner, {}, async () => ({
    stdout: "bad\n",
    stderr: "",
    code: 0,
  }));

  await expect(scaleCheck.run()).rejects.toThrow("a request failed");

  expect(scales(runner).at(-1)).toBe(2);
  expect(state.desired).toBe(2);
});

test("a deployment that never reaches the peak fails naming the counts and restores the starting count", async () => {
  const { runner, state } = cluster(2, 3);

  await expect(check(runner).scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff reached 3 of 4 ready replicas after 5 reads; check the sync is not reverting the scale and the cluster has room",
  );

  expect(state.desired).toBe(2);
});

test("refuses to run when the host 1-minute load average is at the limit, before touching the cluster", async () => {
  const { runner } = cluster(2);
  const { scaleCheck, loadRunner } = check(runner, {}, undefined, 10);

  await expect(scaleCheck.run()).rejects.toThrow(
    "host 1-minute load average 10 is not below 10; wait for the host to quiet down and rerun",
  );

  expect(runner.run).not.toHaveBeenCalled();
  expect(loadRunner.run).not.toHaveBeenCalled();
});

test("refuses a peak that is not above the starting count, before touching the cluster", async () => {
  const { runner } = cluster(2);

  await expect(
    check(runner, { startReplicas: 4, peakReplicas: 4 }).scaleCheck.run(),
  ).rejects.toThrow(
    "peak replicas 4 must be above the starting count 4; pass a larger KORE_SCALE_PEAK_REPLICAS",
  );

  expect(runner.run).not.toHaveBeenCalled();
});

test("records the host before and after the run beside the result", async () => {
  const { runner } = cluster(2);
  const read = vi
    .fn<HostReader["read"]>()
    .mockResolvedValueOnce(BEFORE)
    .mockResolvedValueOnce(AFTER);

  const result = await check(runner, {}, undefined, 1, {
    read,
  }).scaleCheck.run();

  expect(result.host).toEqual({ before: BEFORE, after: AFTER });
});

test("refuses before its first write when no HorizontalPodAutoscaler targets the BFF, naming the count it found", async () => {
  const { runner } = cluster(1, undefined, []);
  const { scaleCheck, loadRunner } = check(runner);

  await expect(scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff has replicas: 1 and no HorizontalPodAutoscaler targets it",
  );

  expect(scales(runner)).toEqual([]);
  expect(loadRunner.run).not.toHaveBeenCalled();
});

test("an autoscaler that targets another Deployment is not a route for the BFF, so the check refuses", async () => {
  const { runner } = cluster(2, undefined, ["golden-path-example-frontend"]);

  await expect(check(runner).scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff has replicas: 2 and no HorizontalPodAutoscaler targets it",
  );

  expect(scales(runner)).toEqual([]);
});

test("omits the host record when no host reader was given", async () => {
  const { runner } = cluster(2);

  const result = await check(runner).scaleCheck.run();

  expect(result).not.toHaveProperty("host");
});

import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { autoscalerOf } from "./golden-path-autoscaler.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";
import {
  GoldenPathScaleCheck,
  type ScaleCheckDeps,
  type ScaleCheckOptions,
} from "./golden-path-scale-check.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { countRound, loadArgs } from "./route-load.js";

vi.mock("./golden-path-autoscaler.js", () => ({ autoscalerOf: vi.fn() }));
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

interface Shape {
  /** The HorizontalPodAutoscaler's bounds on the BFF. */
  minReplicas?: number;
  maxReplicas?: number;
  /** Deployments the autoscalers target; [] is a chart with no autoscaler. */
  autoscaled?: string[];
  /** Ready replicas the Deployment cannot grow past, as a full cluster holds it. */
  stuckAt?: number;
  /** Ready replicas a scale-in stops at once the Deployment has grown past them, as a stalled scale-in holds it. */
  stallAt?: number;
  /** The autoscaler's behavior; unset is the Kubernetes default, a 300 s scale-down window. */
  behavior?: { scaleDown?: { stabilizationWindowSeconds?: number } };
}

/**
 * A fake cluster whose clock the check's sleeps advance. A read after load grows
 * the Deployment by one replica to its maximum; a read shrinks it by one to its
 * minimum only once the scale-down window has passed since the last load. Every
 * call the check makes must be a read.
 */
function cluster(shape: Shape = {}) {
  const minimum = shape.minReplicas ?? 2;
  const maximum = shape.maxReplicas ?? 5;
  const window = shape.behavior?.scaleDown?.stabilizationWindowSeconds ?? 300;
  const clock = { ms: 0 };
  const state = {
    ready: minimum,
    loaded: false,
    lastLoadMs: Number.NEGATIVE_INFINITY,
  };
  vi.mocked(autoscalerOf).mockImplementation((_listing, deployment) =>
    (shape.autoscaled ?? [options.deployment]).includes(deployment)
      ? {
          minReplicas: minimum,
          maxReplicas: maximum,
          scaleDownWindowSeconds: window,
        }
      : undefined,
  );
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    // The listing is parsed by autoscalerOf, mocked above; the check only reads it.
    if (args.includes("hpa")) {
      return { stdout: "{}", stderr: "", code: 0 };
    }
    const ceiling = Math.min(maximum, shape.stuckAt ?? maximum);
    const stallAt = shape.stallAt ?? minimum;
    if (state.loaded) {
      state.ready = Math.min(ceiling, state.ready + 1);
    } else if (
      state.ready > stallAt &&
      clock.ms - state.lastLoadMs >= window * 1000
    ) {
      state.ready -= 1;
    }
    state.loaded = false;
    return {
      stdout: JSON.stringify({
        status: { replicas: state.ready, readyReplicas: state.ready },
      }),
      stderr: "",
      code: 0,
    };
  });
  return { state, clock, runner: { run } satisfies Runner };
}

type Fake = ReturnType<typeof cluster>;

/** A load round that answers stdout, and marks the cluster as loaded at the clock's time. */
function answer(fake: Fake, stdout: string): Runner["run"] {
  return async () => {
    fake.state.loaded = true;
    fake.state.lastLoadMs = fake.clock.ms;
    return { stdout, stderr: "", code: 0 };
  };
}

/** Seconds on the fake clock since the last load round, which is since the load stopped. */
const sinceLoadSeconds = (fake: Fake) =>
  (fake.clock.ms - fake.state.lastLoadMs) / 1000;

function check(
  fake: Fake,
  overrides: Partial<ScaleCheckOptions> = {},
  {
    load = answer(fake, "ok\n"),
    loadAverage = 1,
    host,
  }: { load?: Runner["run"]; loadAverage?: number; host?: HostReader } = {},
) {
  const loadRunner = { run: vi.fn<Runner["run"]>(load) } satisfies Runner;
  const deps: ScaleCheckDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async (seconds) => {
      fake.clock.ms += seconds * 1000;
    }),
    loadAverage: vi.fn(() => loadAverage),
    now: vi.fn(() => fake.clock.ms),
  };
  return {
    loadRunner,
    deps,
    scaleCheck: new GoldenPathScaleCheck(
      fake.runner,
      loadRunner,
      { ...options, ...overrides },
      deps,
      host,
    ),
  };
}

const writes = (fake: Fake) =>
  fake.runner.run.mock.calls.filter(([, args]) => !args.includes("get"));

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

test("waits for the autoscaler's minimum, grows the BFF under load to at least the peak, then waits for it to return to the minimum, recording the start, the most it reached and the end", async () => {
  const fake = cluster();

  const result = await check(fake).scaleCheck.run();

  expect(result.replicas.start).toBe(2);
  expect(result.replicas.peak).toBeGreaterThanOrEqual(4);
  expect(result.replicas.peak).toBeLessThanOrEqual(5);
  expect(result.replicas.end).toBe(2);
  expect(result.autoscaler).toEqual({
    minReplicas: 2,
    maxReplicas: 5,
    scaleDownWindowSeconds: 300,
  });
});

test("waits the default 300 s scale-down window plus a 60 s margin after the load stops, even where the BFF is back at its minimum sooner", async () => {
  const fake = cluster();

  await check(fake).scaleCheck.run();

  expect(sinceLoadSeconds(fake)).toBeGreaterThanOrEqual(360);
});

test("reads the autoscaler's custom scale-down window and waits it out, not the 300 s default", async () => {
  const fake = cluster({
    behavior: { scaleDown: { stabilizationWindowSeconds: 600 } },
  });

  const result = await check(fake).scaleCheck.run();

  expect(result.autoscaler.scaleDownWindowSeconds).toBe(600);
  expect(result.replicas.end).toBe(2);
  expect(sinceLoadSeconds(fake)).toBeGreaterThanOrEqual(660);
});

test("writes nothing to the cluster: every kubectl call the check makes is a read, so the autoscaler alone moves the replica count", async () => {
  const fake = cluster();

  await check(fake).scaleCheck.run();

  expect(fake.runner.run).toHaveBeenCalled();
  expect(writes(fake)).toEqual([]);
});

test("addresses the configured context, namespace and deployment, never the current context", async () => {
  const fake = cluster();

  await check(fake).scaleCheck.run();

  for (const [command, args] of fake.runner.run.mock.calls) {
    expect(command).toBe("kubectl");
    expect(args.slice(0, 4)).toEqual([
      "--context",
      "k3d-kore-local",
      "--namespace",
      "golden-path-example--local",
    ]);
  }
  expect(fake.runner.run.mock.calls[0]?.[1]).toEqual([
    "--context",
    "k3d-kore-local",
    "--namespace",
    "golden-path-example--local",
    "get",
    "hpa",
    "--output",
    "json",
  ]);
});

test("sends the golden-path load while the BFF scales out, and reports the requests, none failed, under the golden-path route set", async () => {
  const fake = cluster();
  const { scaleCheck, loadRunner } = check(fake);

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

test("a deployment that never reaches the peak under load fails naming the counts, and makes no cluster write", async () => {
  const fake = cluster({ stuckAt: 3 });

  await expect(check(fake).scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff reached 3 of 4 ready replicas after 5 reads; check the autoscaler can scale out under load (its CPU is measured against the container's request) and the cluster has room",
  );

  expect(writes(fake)).toEqual([]);
});

test("a deployment whose scale-in stalls above the autoscaler's minimum past its window, margin and termination allowance fails naming the count it holds and the window", async () => {
  const fake = cluster({ stallAt: 3 });

  await expect(check(fake).scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff still has 3 ready replicas 480 seconds after the load stopped, not its minimum of 2; the autoscaler has not scaled back in (its scale-down window is 300 s, plus a 60 s margin and a 120 s allowance for the Pods to terminate)",
  );
});

test("a failed request ends the load and fails the check naming the route and the status, with no cluster write", async () => {
  const fake = cluster();
  const { scaleCheck } = check(
    fake,
    {},
    {
      load: answer(fake, "bad\n"),
    },
  );

  await expect(scaleCheck.run()).rejects.toThrow(
    "a request failed during the scale check of golden-path-example--local/golden-path-example-bff: route / answered 503 for 1 of 50 requests, expected 200",
  );

  expect(writes(fake)).toEqual([]);
});

test("refuses before any load when no HorizontalPodAutoscaler targets the BFF", async () => {
  const fake = cluster({ autoscaled: [] });
  const { scaleCheck, loadRunner } = check(fake);

  await expect(scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff has no HorizontalPodAutoscaler that targets it",
  );

  expect(loadRunner.run).not.toHaveBeenCalled();
  expect(writes(fake)).toEqual([]);
});

test("an autoscaler that targets another Deployment is not a route for the BFF, so the check refuses", async () => {
  const fake = cluster({ autoscaled: ["golden-path-example-frontend"] });
  const { scaleCheck, loadRunner } = check(fake);

  await expect(scaleCheck.run()).rejects.toThrow(
    "golden-path-example--local/golden-path-example-bff has no HorizontalPodAutoscaler that targets it",
  );

  expect(loadRunner.run).not.toHaveBeenCalled();
});

test("refuses a peak that is not above the autoscaler's minimum, before any load", async () => {
  const fake = cluster();
  const { scaleCheck, loadRunner } = check(fake, { peakReplicas: 2 });

  await expect(scaleCheck.run()).rejects.toThrow(
    "peak replicas 2 must be above the autoscaler's minimum 2; pass a larger KORE_SCALE_PEAK_REPLICAS",
  );

  expect(loadRunner.run).not.toHaveBeenCalled();
  expect(writes(fake)).toEqual([]);
});

test("refuses a peak above the autoscaler's maximum, which it could never reach, before any load", async () => {
  const fake = cluster();
  const { scaleCheck, loadRunner } = check(fake, { peakReplicas: 6 });

  await expect(scaleCheck.run()).rejects.toThrow(
    "peak replicas 6 is above the autoscaler's maximum 5; pass a KORE_SCALE_PEAK_REPLICAS of at most 5",
  );

  expect(loadRunner.run).not.toHaveBeenCalled();
});

test("refuses when the host 1-minute load average is at the limit, before any load", async () => {
  const fake = cluster();
  const { scaleCheck, loadRunner } = check(fake, {}, { loadAverage: 10 });

  await expect(scaleCheck.run()).rejects.toThrow(
    "host 1-minute load average 10 is not below 10; wait for the host to quiet down and rerun",
  );

  expect(loadRunner.run).not.toHaveBeenCalled();
});

test("records the host before and after the run beside the result", async () => {
  const fake = cluster();
  const read = vi
    .fn<HostReader["read"]>()
    .mockResolvedValueOnce(BEFORE)
    .mockResolvedValueOnce(AFTER);

  const result = await check(fake, {}, { host: { read } }).scaleCheck.run();

  expect(result.host).toEqual({ before: BEFORE, after: AFTER });
});

test("omits the host record when no host reader was given", async () => {
  const fake = cluster();

  const result = await check(fake).scaleCheck.run();

  expect(result).not.toHaveProperty("host");
});

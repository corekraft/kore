import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordingRunner } from "../runtime/runner.js";
import type { RunResult } from "../runtime/runner.js";
import {
  IngressMeasurement,
  ingressRoutes,
  parsePodMetrics,
  summarizeSamples,
} from "./ingress-measurement.js";
import type { MeasurementOptions } from "./ingress-measurement.js";

const metrics = (
  pods: { name: string; containers: [string, string][] }[],
): string =>
  JSON.stringify({
    kind: "PodMetricsList",
    items: pods.map(({ name, containers }) => ({
      metadata: { name, namespace: "kore-system" },
      containers: containers.map(([cpu, memory]) => ({
        name: "proxy",
        usage: { cpu, memory },
      })),
    })),
  });

const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });

function options(
  overrides: Partial<MeasurementOptions> = {},
): MeasurementOptions {
  return {
    kubeContext: "k3d-kore-local",
    gateway: { namespace: "kore-system", name: "kore-gateway" },
    hostname: "kore.local",
    port: 8443,
    caRoot: "/ca",
    settleSeconds: 60,
    sampleCount: 2,
    sampleIntervalSeconds: 20,
    requestsPerRoute: 50,
    concurrency: 4,
    maxLoadAverage: 10,
    ...overrides,
  };
}

function fixture(
  responses: RunResult[],
  overrides: Partial<MeasurementOptions> = {},
) {
  const runner = new RecordingRunner(responses);
  const loadRunner = new RecordingRunner();
  const sleeps: number[] = [];
  const measurement = new IngressMeasurement(
    runner,
    loadRunner,
    options(overrides),
    {
      sleep: async (seconds) => {
        sleeps.push(seconds);
      },
      loadAverage: () => 1,
    },
  );
  return { runner, loadRunner, sleeps, measurement };
}

test("parses nanocore, millicore and Ki/Mi quantities from the metrics API deterministically", () => {
  const output = metrics([
    { name: "gw-a", containers: [["6863746n", "68716Ki"]] },
    { name: "gw-b", containers: [["2m", "10Mi"]] },
  ]);
  assert.deepEqual(parsePodMetrics(output), parsePodMetrics(output));
  const [a, b] = parsePodMetrics(output);
  assert.equal(a?.name, "gw-a");
  assert.equal(a?.cpuMillicores, 6.864);
  assert.equal(a?.memoryMiB, 67.1);
  assert.equal(b?.cpuMillicores, 2);
  assert.equal(b?.memoryMiB, 10);
});

test("sums every container of a pod and rejects unreadable quantities", () => {
  const [pod] = parsePodMetrics(
    metrics([
      {
        name: "gw",
        containers: [
          ["1m", "1Mi"],
          ["2m", "3Mi"],
        ],
      },
    ]),
  );
  assert.equal(pod?.cpuMillicores, 3);
  assert.equal(pod?.memoryMiB, 4);
  assert.throws(
    () =>
      parsePodMetrics(metrics([{ name: "x", containers: [["abc", "1Mi"]] }])),
    /unreadable cpu quantity abc/,
  );
  assert.throws(() => parsePodMetrics("not json"), /not valid JSON/);
});

test("summarizes samples as median and peak of the per-sample pod totals", () => {
  const summary = summarizeSamples([
    [{ name: "a", cpuMillicores: 10, memoryMiB: 60 }],
    [{ name: "a", cpuMillicores: 30, memoryMiB: 64 }],
    [{ name: "a", cpuMillicores: 20, memoryMiB: 62 }],
  ]);
  assert.deepEqual(summary, {
    samples: 3,
    cpuMillicores: { median: 20, max: 30 },
    memoryMiB: { median: 62, max: 64 },
  });
});

test("a measurement with no ingress pod metrics fails and names the selector", async () => {
  const { measurement } = fixture([ok(metrics([]))]);
  await assert.rejects(
    measurement.measure(),
    /no pod metrics for gateway.networking.k8s.io\/gateway-name=kore-gateway in kore-system/,
  );
});

test("the same routes are used for every measurement", () => {
  assert.deepEqual(
    ingressRoutes.map((route) => route.path),
    ["/livez", "/readyz", "/api", "/api/protected"],
  );
});

test("refuses to measure while the host load average is at or above the limit", async () => {
  const runner = new RecordingRunner();
  const loadRunner = new RecordingRunner();
  const measurement = new IngressMeasurement(runner, loadRunner, options(), {
    sleep: async () => undefined,
    loadAverage: () => 42,
  });
  await assert.rejects(measurement.measure(), /load average 42.* below 10/);
  assert.equal(runner.calls.length + loadRunner.calls.length, 0);
});

test("issues only read commands through the runner, plus the fixed curl load", async () => {
  const sample = ok(metrics([{ name: "gw", containers: [["5m", "50Mi"]] }]));
  const { runner, loadRunner, sleeps, measurement } = fixture([sample, sample]);
  const result = await measurement.measure();
  assert.equal(result.summary.samples, 2);
  const kubectl = runner.calls.filter(({ command }) => command === "kubectl");
  assert.equal(kubectl.length, 2);
  for (const { args } of kubectl) {
    assert.deepEqual(args.slice(0, 2), ["--context", "k3d-kore-local"]);
    assert.equal(args[2], "get");
    assert.equal(args[3], "--raw");
    assert.match(String(args[4]), /^\/apis\/metrics\.k8s\.io\/v1beta1\//);
  }
  for (const { command, args } of [...runner.calls, ...loadRunner.calls]) {
    assert.ok(["kubectl", "curl"].includes(command), command);
    assert.ok(
      !args.some((arg) =>
        ["apply", "delete", "patch", "create", "replace", "scale"].includes(
          arg,
        ),
      ),
      `${command} ${args.join(" ")}`,
    );
  }
  assert.equal(sleeps[0], 60);
});

test("the load verifies the local CA and never disables certificate checks", async () => {
  const sample = ok(metrics([{ name: "gw", containers: [["5m", "50Mi"]] }]));
  const { loadRunner, measurement } = fixture([sample, sample]);
  await measurement.measure();
  const curls = loadRunner.calls.filter(({ command }) => command === "curl");
  assert.ok(curls.length > 0);
  for (const { args } of curls) {
    assert.ok(args.includes("--cacert"));
    assert.ok(args.includes("/ca/rootCA.pem"));
    assert.ok(!args.includes("--insecure"));
    assert.ok(!args.includes("-k"));
    assert.ok(args.includes("kore.local:8443:127.0.0.1"));
  }
});

test("two runs against identical metrics produce identical results", async () => {
  const sample = ok(metrics([{ name: "gw", containers: [["5m", "50Mi"]] }]));
  const first = await fixture([sample, sample]).measurement.measure();
  const second = await fixture([sample, sample]).measurement.measure();
  assert.deepEqual(first, second);
});

test("the result states the fixed method so it can be repeated exactly", async () => {
  const sample = ok(metrics([{ name: "gw", containers: [["5m", "50Mi"]] }]));
  const { measurement } = fixture([sample, sample]);
  const { method } = await measurement.measure();
  assert.deepEqual(method, {
    gateway: "kore-system/kore-gateway",
    routes: ["/livez", "/readyz", "/api", "/api/protected"],
    requestsPerRoute: 50,
    concurrency: 4,
    settleSeconds: 60,
    sampleCount: 2,
    sampleIntervalSeconds: 20,
  });
});

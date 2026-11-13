import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordingRunner, type RunResult } from "../runtime/index.js";
import { IngressMeasurement, ingressRoutes } from "./ingress-measurement.js";
import {
  FakeLoad,
  expectedStatus,
  fixture,
  ok,
  metrics,
  options,
  sampleResponses,
} from "./ingress-measurement.fixtures.js";

test("a measurement with no ingress pod metrics fails and names the selector", async () => {
  const { measurement } = fixture([ok(metrics([]))]);
  await assert.rejects(
    measurement.measure(),
    /no pod metrics for gateway.networking.k8s.io\/gateway-name=kore-gateway in kore-system/,
  );
});

test("the reference app routes carry the status each must answer with", () => {
  assert.deepEqual(
    ingressRoutes.map(({ path, status }) => [path, status]),
    [
      ["/livez", 200],
      ["/readyz", 200],
      ["/api", 200],
      ["/api/protected", 403],
    ],
  );
});

test("refuses to measure while the host load average is at or above the limit", async () => {
  const runner = new RecordingRunner();
  const load = new FakeLoad();
  const measurement = new IngressMeasurement(runner, load, options(), {
    sleep: async () => undefined,
    loadAverage: () => 42,
    now: () => 0,
  });
  await assert.rejects(measurement.measure(), /load average 42.* below 10/);
  assert.equal(runner.calls.length + load.calls.length, 0);
});

test("issues only read commands through the runner, plus the fixed curl load", async () => {
  const { runner, load, sleeps, measurement } = fixture(sampleResponses(2));
  const result = await measurement.measure();
  assert.equal(result.summary.ingress.samples, 2);
  const kubectl = runner.calls.filter(({ command }) => command === "kubectl");
  assert.equal(kubectl.length, 4);
  for (const { args } of kubectl) {
    assert.deepEqual(args.slice(0, 2), ["--context", "k3d-kore-local"]);
    assert.equal(args[2], "get");
    assert.equal(args[3], "--raw");
    assert.match(String(args[4]), /^\/apis\/metrics\.k8s\.io\/v1beta1\//);
  }
  for (const { command, args } of [
    ...runner.calls,
    ...(load as FakeLoad).calls,
  ]) {
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

test("samples the ztunnel pods in their own column, separate from the Gateway pods", async () => {
  const { runner, measurement } = fixture(sampleResponses(2));
  const result = await measurement.measure();
  const paths = runner.calls.map(({ args }) => String(args[4]));
  assert.match(paths[0] ?? "", /namespaces\/kore-system\/pods\?labelSelector=/);
  assert.match(
    paths[1] ?? "",
    /namespaces\/istio-system\/pods\?labelSelector=app\.kubernetes\.io%2Fname%3Dztunnel/,
  );
  assert.deepEqual(result.pods, { ingress: ["gw"], ztunnel: ["zt"] });
  assert.equal(result.summary.ingress.cpuMillicores.median, 5);
  assert.equal(result.summary.ztunnel.cpuMillicores.median, 2);
  assert.equal(result.summary.ztunnel.memoryMiB.median, 20);
});

test("records the load average at each sample and its rise during the run", async () => {
  const { measurement } = fixture(sampleResponses(2));
  const result = await measurement.measure();
  // The first reading is the start check; each sample reads it again.
  assert.deepEqual(
    result.samples.map((sample) => sample.loadAverage),
    [2, 3],
  );
  assert.deepEqual(result.loadAverage, { start: 1, max: 3 });
});

test("records completed requests, elapsed time and the request rate", async () => {
  const { measurement } = fixture(sampleResponses(2));
  const { load } = await measurement.measure();
  assert.ok(load.requests > 0);
  assert.equal(load.requests % 50, 0);
  assert.equal(load.elapsedSeconds, 40);
  assert.equal(
    load.requestsPerSecond,
    Math.round((load.requests / 40) * 10) / 10,
  );
});

test("a route answering the wrong status fails the measurement and names the route", async () => {
  const wrong = new FakeLoad((path) =>
    path === "/api" ? 502 : (expectedStatus[path] ?? 0),
  );
  const { measurement } = fixture(sampleResponses(2), {}, wrong);
  await assert.rejects(
    measurement.measure(),
    /route \/api answered 502 for 50 of 50 requests, expected 200/,
  );
});

test("a protected route that stops denying fails the measurement", async () => {
  const open = new FakeLoad((path) =>
    path === "/api/protected" ? 200 : (expectedStatus[path] ?? 0),
  );
  const { measurement } = fixture(sampleResponses(2), {}, open);
  await assert.rejects(
    measurement.measure(),
    /route \/api\/protected answered 200 for 50 of 50 requests, expected 403/,
  );
});

test("a round that completes fewer requests than were sent fails the measurement", async () => {
  const short = new FakeLoad(undefined, 10);
  const { measurement } = fixture(sampleResponses(2), {}, short);
  await assert.rejects(
    measurement.measure(),
    /route \/livez completed 10 of 50 requests/,
  );
});

test("two runs against identical metrics produce identical results", async () => {
  const first = await fixture(sampleResponses(2)).measurement.measure();
  const second = await fixture(sampleResponses(2)).measurement.measure();
  assert.deepEqual(first, second);
});

test("the result states the fixed method so it can be repeated exactly", async () => {
  const { measurement } = fixture(sampleResponses(2));
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

test("a failing request load fails the measurement with an actionable message", async () => {
  const failing = {
    run: async (): Promise<RunResult> => {
      throw new Error("curl failed (7): connection refused");
    },
  };
  const { measurement } = fixture(sampleResponses(2), {}, failing);
  await assert.rejects(
    measurement.measure(),
    /request load to https:\/\/kore.local:8443 failed: curl failed \(7\).*load balancer maps port 8443/,
  );
});

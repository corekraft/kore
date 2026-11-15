import { expect, test } from "vitest";
import { fakeRunner } from "./platform-support.js";
import type { MeasurementOptions } from "./ingress-measurement.js";
import { probeLatency } from "./ingress-probe.js";

const options: MeasurementOptions = {
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
  latencyProbesPerRoute: 3,
};

test("without latencyProbesPerRoute no timing request is sent", async () => {
  const load = fakeRunner(() => "0.010\n");

  const { latencyProbesPerRoute: _unset, ...unprobed } = options;
  const times = await probeLatency(load.runner, unprobed);

  expect(times).toEqual([]);
  expect(load.run).not.toHaveBeenCalled();
});

test("each route is timed with sequential GETs and the local CA, never insecure or parallel", async () => {
  const load = fakeRunner(() => "0.010\n");

  await probeLatency(load.runner, options);

  expect(load.run).toHaveBeenCalledTimes(4);
  expect(load.run.mock.calls[0]).toEqual([
    "curl",
    [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{time_total}\\n",
      "--connect-timeout",
      "5",
      "--max-time",
      "60",
      "--cacert",
      "/ca/rootCA.pem",
      "--resolve",
      "kore.local:8443:127.0.0.1",
      "https://kore.local:8443/livez#[1-3]",
    ],
    { capture: true },
  ]);
  for (const [, args] of load.run.mock.calls) {
    expect(args).not.toContain("--insecure");
    expect(args).not.toContain("--parallel");
  }
});

test("probe times are converted from seconds to milliseconds", async () => {
  const load = fakeRunner(() => "0.010\n0.020\n0.030\n");

  const times = await probeLatency(load.runner, options);

  expect(times).toEqual(Array.from({ length: 4 }, () => [10, 20, 30]).flat());
});

test("an unreadable probe time fails naming the route and the fix", async () => {
  const load = fakeRunner(() => "0.010\nnot-a-time\n");

  await expect(probeLatency(load.runner, options)).rejects.toThrow(
    "latency probe of /livez returned an unreadable time 'not-a-time'; check that curl reached https://kore.local:8443",
  );
});

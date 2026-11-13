// Shared fixtures for the ingress measurement specs.
import { RecordingRunner } from "../runtime/runner.js";
import type { RunOptions, RunResult, Runner } from "../runtime/runner.js";
import { IngressMeasurement } from "./ingress-measurement.js";
import type { MeasurementOptions } from "./ingress-measurement.js";

export const metrics = (
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

export const ok = (stdout: string): RunResult => ({
  stdout,
  stderr: "",
  code: 0,
});
export const gateway = ok(
  metrics([{ name: "gw", containers: [["5m", "50Mi"]] }]),
);
export const ztunnel = ok(
  metrics([{ name: "zt", containers: [["2m", "20Mi"]] }]),
);
/** One sample reads the Gateway pods, then the ztunnel pods. */
export const sampleResponses = (count: number): RunResult[] =>
  Array.from({ length: count }, () => [gateway, ztunnel]).flat();

export const expectedStatus: Record<string, number> = {
  "/livez": 200,
  "/readyz": 200,
  "/api": 200,
  "/api/protected": 403,
};

/** A load runner answering every request of a curl call with `statusFor(path)`. */
export class FakeLoad implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  constructor(
    private readonly statusFor: (path: string) => number = (path) =>
      expectedStatus[path] ?? 0,
    private readonly requests = 50,
  ) {}
  async run(
    command: string,
    args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    const url = String(args.at(-1));
    const path = /:\d+(\/[^#]*)#/.exec(url)?.[1] ?? "";
    return ok(`${this.statusFor(path)}\n`.repeat(this.requests));
  }
}

export function options(
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

export function fixture(
  responses: RunResult[],
  overrides: Partial<MeasurementOptions> = {},
  load: Runner = new FakeLoad(),
) {
  const runner = new RecordingRunner(responses);
  const sleeps: number[] = [];
  let clock = 0;
  const loads = [1, 2, 3, 4, 5, 6, 7];
  const measurement = new IngressMeasurement(runner, load, options(overrides), {
    sleep: async (seconds) => {
      sleeps.push(seconds);
      clock += seconds * 1000;
    },
    loadAverage: () => loads.shift() ?? 9,
    now: () => clock,
  });
  return { runner, load, sleeps, measurement };
}

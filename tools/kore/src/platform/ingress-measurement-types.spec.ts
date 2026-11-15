import { expect, test } from "vitest";
import { ingressMeasurementDefaults } from "./ingress-measurement-types.js";

test("the fixed method values are the ones both baselines were measured with", () => {
  expect(ingressMeasurementDefaults).toEqual({
    settleSeconds: 60,
    sampleCount: 6,
    sampleIntervalSeconds: 20,
    requestsPerRoute: 200,
    concurrency: 4,
    maxLoadAverage: 10,
    latencyProbesPerRoute: 20,
  });
});

test("the defaults set no target rate, so the load stays closed-loop", () => {
  expect(ingressMeasurementDefaults).not.toHaveProperty(
    "targetRequestsPerSecond",
  );
});

import { expect, test } from "vitest";
import {
  cpuPerRequest,
  matchRate,
  parseTargetRate,
  pacingPlan,
  rateTolerancePercent,
  targetRateVariable,
} from "./ingress-pacing.js";

test("an unset or empty target rate means the unpaced closed-loop load", () => {
  expect(parseTargetRate(undefined)).toBeUndefined();
  expect(parseTargetRate("")).toBeUndefined();
});

test("a valid target rate is read as a number", () => {
  expect(parseTargetRate("35")).toBe(35);
  expect(parseTargetRate("29.5")).toBe(29.5);
});

test.each(["0", "-5", "NaN", "abc", "Infinity", "12x"])(
  "target rate '%s' is rejected naming the variable",
  (raw) => {
    expect(() => parseTargetRate(raw)).toThrow(
      `${targetRateVariable} must be a positive number of requests per second, got '${raw}'; unset it for the unpaced load`,
    );
  },
);

test.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
  "a paced plan for the option value %s is rejected naming the variable, never a hang",
  (target) => {
    expect(() => pacingPlan(target, 200)).toThrow(
      `${targetRateVariable} must be a positive number of requests per second, got '${target}'; unset it for the unpaced load`,
    );
  },
);

test("a batch is one second of the target rate, so the offered rate is steady", () => {
  expect(pacingPlan(40, 200)).toEqual({ batchSize: 40, batchSeconds: 1 });
});

test("a batch never exceeds the requests per route", () => {
  expect(pacingPlan(500, 200)).toEqual({ batchSize: 200, batchSeconds: 0.4 });
});

test("a target below one request per second still sends whole requests, spaced out", () => {
  expect(pacingPlan(0.5, 200)).toEqual({ batchSize: 1, batchSeconds: 2 });
});

test("an achieved rate within the tolerance of the target is matched", () => {
  expect(matchRate(40, 43.9)).toEqual({
    targetRequestsPerSecond: 40,
    achievedRequestsPerSecond: 43.9,
    tolerancePercent: rateTolerancePercent,
    status: "matched",
  });
  expect(matchRate(40, 36).status).toBe("matched");
});

test("an achieved rate outside the tolerance is a rate_mismatch, never matched", () => {
  expect(matchRate(40, 35.9).status).toBe("rate_mismatch");
  expect(matchRate(40, 44.1).status).toBe("rate_mismatch");
  expect(matchRate(40, 0).status).toBe("rate_mismatch");
});

test("cpu per request is the median millicores over the achieved requests per second", () => {
  expect(cpuPerRequest({ ingress: 10, ztunnel: 5 }, 40)).toEqual({
    ingress: 0.25,
    ztunnel: 0.125,
  });
  expect(cpuPerRequest({ ingress: 5, ztunnel: 1 }, 3)).toEqual({
    ingress: 1.667,
    ztunnel: 0.333,
  });
});

test("cpu per request is not reported when no request completed", () => {
  expect(cpuPerRequest({ ingress: 10, ztunnel: 5 }, 0)).toEqual({});
});

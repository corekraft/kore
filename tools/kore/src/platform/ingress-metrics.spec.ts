import assert from "node:assert/strict";
import { test } from "vitest";
import {
  baselineOf,
  confirmedBelow,
  judgeOutcome,
  parsePodMetrics,
  runSpreadPercent,
  summarizeSamples,
} from "./ingress-metrics.js";

const metrics = (
  pods: { name: string; containers: [string, string][] }[],
): string =>
  JSON.stringify({
    kind: "PodMetricsList",
    items: pods.map(({ name, containers }) => ({
      metadata: { name },
      containers: containers.map(([cpu, memory]) => ({
        name: "proxy",
        usage: { cpu, memory },
      })),
    })),
  });

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

test("reads every CPU and memory unit the metrics API can report", () => {
  const [pod] = parsePodMetrics(
    metrics([
      {
        name: "gw",
        containers: [
          ["500u", "1Gi"],
          ["1", "1048576"],
        ],
      },
    ]),
  );
  assert.equal(pod?.cpuMillicores, 1000.5);
  assert.equal(pod?.memoryMiB, 1025);
  assert.throws(
    () =>
      parsePodMetrics(metrics([{ name: "x", containers: [["1m", "9Zi"]] }])),
    /unreadable memory quantity 9Zi/,
  );
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

const summaryOf = (cpu: number, memory: number) => ({
  samples: 6,
  cpuMillicores: { median: cpu, max: cpu },
  memoryMiB: { median: memory, max: memory },
});

test("the baseline is the mean of the runs' medians and the thresholds follow from it exactly", () => {
  const baseline = baselineOf([summaryOf(60, 48), summaryOf(40, 50)]);
  assert.deepEqual(baseline, { cpuMillicores: 50, memoryMiB: 49 });
  assert.deepEqual(confirmedBelow(baseline, 20), {
    cpuMillicores: 40,
    memoryMiB: 39.2,
  });
  assert.throws(() => baselineOf([]), /at least one run/);
});

const runs = [summaryOf(60, 48), summaryOf(40, 50)]; // baseline 50m, 49MiB

test("the outcome is confirmed on a 20% drop in median CPU or memory, refuted when neither drops", () => {
  // CPU spread between the runs is 40%, memory 4%.
  assert.equal(judgeOutcome(runs, summaryOf(50, 39), 20), "confirmed");
  assert.equal(judgeOutcome(runs, summaryOf(45, 45), 20), "inconclusive");
  assert.equal(judgeOutcome(runs, summaryOf(50, 49), 20), "refuted");
  assert.equal(judgeOutcome(runs, summaryOf(60, 60), 20), "refuted");
});

test("a drop no larger than the run-to-run spread is not enough to confirm", () => {
  // CPU 50 -> 38 is a 24% drop, but the baseline runs differ by 40%.
  assert.equal(judgeOutcome(runs, summaryOf(38, 49), 20), "inconclusive");
  // CPU 50 -> 28 is a 44% drop, beyond the 40% spread.
  assert.equal(judgeOutcome(runs, summaryOf(28, 49), 20), "confirmed");
});

test("the spread of the baseline runs is reported per metric", () => {
  assert.deepEqual(runSpreadPercent(runs), {
    cpuMillicores: 40,
    memoryMiB: 4.1,
  });
});

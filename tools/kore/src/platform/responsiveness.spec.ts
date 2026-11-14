import { expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  ResponsivenessProbe,
  evaluateResponsiveness,
  formatResponsivenessTable,
  responsivenessLimits,
  type ResponsivenessSample,
} from "./responsiveness.js";

const ok = (latencyMs: number, second = 0): ResponsivenessSample => ({
  second,
  ok: true,
  latencyMs,
});

test("probes /readyz in the named context and records the latency of a healthy answer", async () => {
  const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", code: 0 });
  const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
  const probe = new ResponsivenessProbe({ run } as Runner, "k3d-kore-test", {
    now,
  });

  expect(await probe.probe(3)).toEqual({ second: 3, ok: true, latencyMs: 42 });
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    ["--context", "k3d-kore-test", "get", "--raw", "/readyz"],
    expect.objectContaining({ capture: true }),
  );
});

test("records a failed answer with its cause instead of throwing", async () => {
  const run = vi.fn().mockRejectedValue(new Error("connection refused"));
  const probe = new ResponsivenessProbe({ run } as Runner, "ctx", {
    now: () => 5,
  });

  expect(await probe.probe(1)).toEqual({
    second: 1,
    ok: false,
    latencyMs: 0,
    error: "connection refused",
  });
});

test("passes when every answer succeeds and the 95th percentile is within 2 seconds", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ok(100 + i, i));
  const result = evaluateResponsiveness(samples);

  expect(result.pass).toBe(true);
  expect(result.failures).toBe(0);
  expect(result.p95Ms).toBe(118);
  expect(result.reasons).toEqual([]);
});

test("fails when the API failed even once, and names the count", () => {
  const result = evaluateResponsiveness([
    ok(10),
    { second: 1, ok: false, latencyMs: 0, error: "x" },
  ]);

  expect(result.pass).toBe(false);
  expect(result.reasons).toEqual(["the API failed 1 of 2 probes"]);
});

test("fails when the p95 latency exceeds the limit, and passes at exactly the limit", () => {
  const slow = Array.from({ length: 20 }, (_, i) => ok(i < 18 ? 50 : 2500, i));
  expect(evaluateResponsiveness(slow).pass).toBe(false);
  expect(evaluateResponsiveness(slow).reasons[0]).toMatch(
    /p95 .*2500 ms.*2000 ms/,
  );
  expect(evaluateResponsiveness([ok(responsivenessLimits.maxP95Ms)]).pass).toBe(
    true,
  );
});

test("refuses to pass with no probes, since silence proves nothing", () => {
  const result = evaluateResponsiveness([]);

  expect(result.pass).toBe(false);
  expect(result.reasons).toEqual(["no probes ran"]);
});

test("prints one row per probe, with the verdict last", () => {
  const samples = [
    ok(12, 0),
    { second: 1, ok: false, latencyMs: 0, error: "boom" },
  ];
  const table = formatResponsivenessTable(
    samples,
    evaluateResponsiveness(samples),
  );

  expect(table).toContain("second | status | latency ms");
  expect(table).toContain("0 | ok | 12");
  expect(table).toContain("1 | FAILED | - | boom");
  expect(table.trimEnd().split("\n").at(-1)).toMatch(/^FAIL/);
});

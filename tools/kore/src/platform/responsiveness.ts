import type { Runner } from "../runtime/index.js";

// Docs: infra/plans/14-test-tiers.md (#405)
//
// The cluster-responsiveness probe: while the unit suite runs at its shipped
// worker default beside a converged cluster, the API's /readyz is polled once a
// second. The run fails if the API ever fails to answer or the 95th percentile
// of the latencies exceeds the limit. Read-only: `kubectl get --raw`.

export const responsivenessLimits = { maxP95Ms: 2000 } as const;

export interface ResponsivenessSample {
  /** Seconds since the unit suite started. */
  second: number;
  ok: boolean;
  /** Milliseconds for the answer; 0 when it failed. */
  latencyMs: number;
  error?: string;
}

export interface ResponsivenessVerdict {
  pass: boolean;
  failures: number;
  p95Ms: number;
  reasons: string[];
}

export class ResponsivenessProbe {
  constructor(
    private readonly runner: Runner,
    private readonly context: string,
    private readonly deps: { now: () => number },
  ) {}

  /** One timed `/readyz` read in the configured context; a failure is recorded, not thrown. */
  async probe(second: number): Promise<ResponsivenessSample> {
    const began = this.deps.now();
    try {
      await this.runner.run(
        "kubectl",
        ["--context", this.context, "get", "--raw", "/readyz"],
        { capture: true },
      );
      return {
        second,
        ok: true,
        latencyMs: Math.round(this.deps.now() - began),
      };
    } catch (error) {
      return {
        second,
        ok: false,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** Nearest-rank 95th percentile of the answered probes' latencies. */
function p95(latencies: number[]): number {
  if (latencies.length === 0) {
    return 0;
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] as number;
}

export function evaluateResponsiveness(
  samples: ResponsivenessSample[],
): ResponsivenessVerdict {
  const failures = samples.filter((sample) => !sample.ok).length;
  const p95Ms = p95(
    samples.filter((sample) => sample.ok).map((sample) => sample.latencyMs),
  );
  const reasons: string[] = [];
  if (samples.length === 0) {
    reasons.push("no probes ran");
  }
  if (failures > 0) {
    reasons.push(`the API failed ${failures} of ${samples.length} probes`);
  }
  if (p95Ms > responsivenessLimits.maxP95Ms) {
    reasons.push(
      `readyz p95 latency was ${p95Ms} ms, over the ${responsivenessLimits.maxP95Ms} ms limit`,
    );
  }
  return { pass: reasons.length === 0, failures, p95Ms, reasons };
}

export function formatResponsivenessTable(
  samples: ResponsivenessSample[],
  verdict: ResponsivenessVerdict,
): string {
  const rows = samples.map((sample) =>
    sample.ok
      ? `${sample.second} | ok | ${sample.latencyMs}`
      : `${sample.second} | FAILED | - | ${sample.error ?? ""}`,
  );
  const last = verdict.pass
    ? `PASS: ${samples.length} probes, p95 ${verdict.p95Ms} ms`
    : `FAIL: ${verdict.reasons.join("; ")}`;
  return ["second | status | latency ms", ...rows, last].join("\n") + "\n";
}

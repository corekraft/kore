import type { Runner } from "../runtime/index.js";
import {
  parseContainerStats,
  parseOomKilledPods,
  parseSwapUsedMiB,
  parseVmMemoryMiB,
} from "./footprint-parse.js";
import { summarizeFootprint } from "./footprint-summary.js";
import type { FootprintSample, FootprintSummary } from "./footprint-summary.js";
import { judgeFootprint, type FootprintVerdict } from "./footprint-verdict.js";

// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
//
// The platform footprint measurement (#614): CPU and memory of the k3d server
// container, the Docker VM's total memory, and the host's swap and load, sampled
// on a clock once the settled platform has idled. It is read-only: `docker
// stats`, `docker info`, `sysctl` and `kubectl get pods`. The method is the same
// for Now, Next and Then, so everything that could vary is a stated option. A
// run also carries its breach verdict (#1107), so an overloaded run reads as
// inconclusive rather than as a pass.

export interface FootprintOptions {
  /** The k3d server container, for example `k3d-kore-local-server-0`. */
  serverContainer: string;
  /** The kubectl context the OOMKilled read names, for example `k3d-kore-local`. */
  kubeContext: string;
  /** Idle wait before the first sample. */
  settleSeconds: number;
  sampleCount: number;
  sampleIntervalSeconds: number;
  /** Measuring is refused at or above this host 1-minute load average. */
  maxLoadAverage: number;
}

/** The fixed method: every horizon's run uses exactly these values. */
export const footprintMeasurementDefaults = {
  settleSeconds: 120,
  sampleCount: 12,
  sampleIntervalSeconds: 20,
  maxLoadAverage: 10,
} as const;

export interface FootprintDeps {
  sleep: (seconds: number) => Promise<void>;
  loadAverage: () => number;
  /** Milliseconds on a monotonic clock. */
  now: () => number;
  /** Milliseconds since the epoch, to compare with pod termination times. */
  epochMilliseconds: () => number;
}

export interface FootprintRun extends FootprintSummary {
  method: FootprintOptions;
  vmMemoryMiB: number;
  elapsedSeconds: number;
  loadAverage: { start: number; max: number };
  /** The loads at or above the ceiling during the run; empty for an untainted run. */
  overCeiling: number[];
  samples: FootprintSample[];
  /** The breach verdict under the owner's rule (#1107). */
  verdict: FootprintVerdict;
}

export class FootprintMeasurement {
  constructor(
    private readonly runner: Runner,
    private readonly options: FootprintOptions,
    private readonly deps: FootprintDeps,
  ) {}

  /** Settles, then samples the server container and the host. */
  async measure(): Promise<FootprintRun> {
    const { maxLoadAverage, sampleCount } = this.options;
    const start = this.deps.loadAverage();
    if (start >= maxLoadAverage) {
      throw new Error(
        `host 1-minute load average ${start} is not below ${maxLoadAverage}; wait for the host to quiet down and rerun`,
      );
    }
    const runStarted = this.deps.epochMilliseconds();
    const vmMemoryMiB = await this.read(
      "the Docker VM memory",
      "check that Docker is running",
      "docker",
      ["info", "--format", "{{.MemTotal}}"],
      parseVmMemoryMiB,
    );
    await this.deps.sleep(this.options.settleSeconds);
    const began = this.deps.now();
    const samples: FootprintSample[] = [];
    for (let index = 0; index < sampleCount; index++) {
      await this.deps.sleep(this.options.sampleIntervalSeconds);
      samples.push(await this.sample());
    }
    const oomKilledPods = await this.oomKilledPods(runStarted);
    const summarized = summarizeFootprint(samples, vmMemoryMiB);
    const loads = samples.map((sample) => sample.loadAverage);
    return {
      method: this.options,
      vmMemoryMiB,
      elapsedSeconds: Math.round((this.deps.now() - began) / 100) / 10,
      loadAverage: { start, max: Math.max(start, ...loads) },
      overCeiling: loads.filter((load) => load >= maxLoadAverage),
      samples,
      ...summarized,
      verdict: judgeFootprint({
        peakMemoryMiB: summarized.summary.memoryMiB.max,
        vmMemoryMiB,
        oomKilledPods,
      }),
    };
  }

  /** The pods, in every namespace, whose last state was OOMKilled since the run began. */
  private oomKilledPods(runStarted: number): Promise<string[]> {
    return this.read(
      "the pods' OOMKilled state",
      `check that kubectl can reach the ${this.options.kubeContext} context`,
      "kubectl",
      [
        "--context",
        this.options.kubeContext,
        "get",
        "pods",
        "--all-namespaces",
        "-o",
        "json",
      ],
      (stdout) => parseOomKilledPods(stdout, runStarted),
    );
  }

  private async sample(): Promise<FootprintSample> {
    const loadAverage = this.deps.loadAverage();
    const usage = await this.read(
      `the ${this.options.serverContainer} container stats`,
      `check that the k3d cluster is running and ${this.options.serverContainer} exists`,
      "docker",
      [
        "stats",
        "--no-stream",
        "--format",
        "{{json .}}",
        this.options.serverContainer,
      ],
      parseContainerStats,
    );
    const swapMiB = await this.read(
      "the macOS swap usage",
      "this measurement needs macOS",
      "sysctl",
      ["vm.swapusage"],
      parseSwapUsedMiB,
    );
    return { ...usage, swapMiB, loadAverage };
  }

  /** Runs one read; any failure names what was being read and how to fix it. */
  private async read<T>(
    subject: string,
    hint: string,
    command: string,
    args: string[],
    parse: (stdout: string) => T,
  ): Promise<T> {
    try {
      const { stdout } = await this.runner.run(command, args, {
        capture: true,
      });
      return parse(stdout);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`reading ${subject} failed: ${cause}; ${hint}`);
    }
  }
}

import type { Runner } from "../runtime/index.js";
import {
  parseContainerStats,
  parseLinuxSwapMiB,
  parseOomKilledPods,
  parseSwapTotalMiB,
  parseSwapUsedMiB,
  parseVmMemoryInUseMiB,
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
// stats`, `docker info`, `kubectl get pods` and the host's swap, from
// `sysctl vm.swapusage` on macOS or `/proc/meminfo` on Linux. The method is
// the same for Now, Next and Then, so everything that could vary is a stated
// option. A
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
  /** The host's platform: linux reads swap from /proc/meminfo, darwin from sysctl; any other is refused. */
  platform: NodeJS.Platform;
  /** Reads a text file of the host, such as /proc/meminfo on Linux. */
  readFile: (path: string) => Promise<string>;
}

export interface FootprintRun extends FootprintSummary {
  method: FootprintOptions;
  /** The host's platform, which chose how its swap was read. */
  platform: NodeJS.Platform;
  vmMemoryMiB: number;
  /** The host's swap total (MiB): the largest read across the samples. */
  swapTotalMiB: number;
  elapsedSeconds: number;
  loadAverage: { start: number; max: number };
  /** The loads at or above the ceiling during the run; empty for an untainted run. */
  overCeiling: number[];
  samples: FootprintSample[];
  /** The Docker VM's memory in use at each sample (MiB), the figure the breach rule judges. */
  vmMemoryInUseMiB: number[];
  /** The breach verdict under the owner's rule (#1107). */
  verdict: FootprintVerdict;
}

/** The host's meminfo, read on Linux, where the host runs Docker itself. */
const hostMeminfo = "/proc/meminfo";

export class FootprintMeasurement {
  constructor(
    private readonly runner: Runner,
    private readonly options: FootprintOptions,
    private readonly deps: FootprintDeps,
  ) {}

  /** Settles, then samples the server container and the host. */
  async measure(): Promise<FootprintRun> {
    const { maxLoadAverage, sampleCount } = this.options;
    const { platform } = this.deps;
    if (platform !== "linux" && platform !== "darwin") {
      throw new Error(
        `host platform ${platform} is not supported; the footprint measurement reads swap on linux and darwin`,
      );
    }
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
    const vmMemoryInUseMiB: number[] = [];
    const swapTotalsMiB: number[] = [];
    for (let index = 0; index < sampleCount; index++) {
      await this.deps.sleep(this.options.sampleIntervalSeconds);
      const taken = await this.sample();
      samples.push(taken.sample);
      vmMemoryInUseMiB.push(taken.vmMemoryInUseMiB);
      swapTotalsMiB.push(taken.swapTotalMiB);
    }
    const oomKilledPods = await this.oomKilledPods(runStarted);
    const summarized = summarizeFootprint(samples, vmMemoryMiB);
    const loads = samples.map((sample) => sample.loadAverage);
    return {
      method: this.options,
      platform,
      vmMemoryMiB,
      swapTotalMiB: Math.max(...swapTotalsMiB),
      elapsedSeconds: Math.round((this.deps.now() - began) / 100) / 10,
      loadAverage: { start, max: Math.max(start, ...loads) },
      overCeiling: loads.filter((load) => load >= maxLoadAverage),
      samples,
      vmMemoryInUseMiB,
      ...summarized,
      verdict: judgeFootprint({
        peakInUseMiB: Math.max(...vmMemoryInUseMiB),
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

  private async sample(): Promise<{
    sample: FootprintSample;
    vmMemoryInUseMiB: number;
    swapTotalMiB: number;
  }> {
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
    const vmMemoryInUseMiB = await this.read(
      "the Docker VM memory in use",
      "check that Docker is running",
      "docker",
      ["stats", "--no-stream", "--format", "{{json .}}"],
      parseVmMemoryInUseMiB,
    );
    const swap = await this.readSwap();
    return {
      sample: { ...usage, swapMiB: swap.usedMiB, loadAverage },
      vmMemoryInUseMiB,
      swapTotalMiB: swap.totalMiB,
    };
  }

  /** The host's swap: `/proc/meminfo` on Linux, `sysctl vm.swapusage` on macOS. */
  private readSwap(): Promise<{ totalMiB: number; usedMiB: number }> {
    if (this.deps.platform === "linux") {
      return this.readWith(
        "the host's swap in /proc/meminfo",
        "check that /proc/meminfo is readable on this host",
        () => this.deps.readFile(hostMeminfo),
        parseLinuxSwapMiB,
      );
    }
    return this.readWith(
      "the macOS swap usage",
      "check that sysctl vm.swapusage runs on this Mac",
      () => this.capture("sysctl", ["vm.swapusage"]),
      (stdout) => ({
        totalMiB: parseSwapTotalMiB(stdout),
        usedMiB: parseSwapUsedMiB(stdout),
      }),
    );
  }

  /** Runs one read-only process; any failure names what was being read and how to fix it. */
  private read<T>(
    subject: string,
    hint: string,
    command: string,
    args: string[],
    parse: (stdout: string) => T,
  ): Promise<T> {
    return this.readWith(
      subject,
      hint,
      () => this.capture(command, args),
      parse,
    );
  }

  /** The stdout of one read-only process. */
  private async capture(command: string, args: string[]): Promise<string> {
    const { stdout } = await this.runner.run(command, args, { capture: true });
    return stdout;
  }

  /** Runs one read and parses it; any failure names what was being read and how to fix it. */
  private async readWith<T>(
    subject: string,
    hint: string,
    fetch: () => Promise<string>,
    parse: (stdout: string) => T,
  ): Promise<T> {
    try {
      return parse(await fetch());
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`reading ${subject} failed: ${cause}; ${hint}`);
    }
  }
}

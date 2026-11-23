import type { Runner } from "../runtime/index.js";
import { parseSwapUsedMiB } from "./footprint-parse.js";
import {
  parseAgentPaneCount,
  parseLinuxSwapUsedMiB,
  parseMemAvailableMiB,
} from "./ingress-host-parse.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// What the host was doing while the ingress measurement ran: load averages,
// swap, the Docker VM's free memory and how many agent panes were running. A
// result recorded on a busy machine is not comparable, so the measurement
// carries these before and after. Everything is read-only: `sysctl`, `docker
// exec ... cat /proc/meminfo`, `/proc/meminfo` on Linux and `hc ls`.

/**
 * Where the agent pane count comes from: `hc ls`, the listing of the live
 * terminals the harness's sessions run in. Every claude session it lists is one pane.
 */
export const agentPaneSource = "hc ls";

/** The host's meminfo, read on Linux, where the host runs Docker itself. */
const hostMeminfo = "/proc/meminfo";

/** The agent pane count, or the named reason it could not be read. */
export type AgentPanes =
  | { count: number; source: string }
  | { count: null; source: string; missing: string };

export interface HostSnapshot {
  load: { oneMinute: number; fiveMinute: number; fifteenMinute: number };
  swapUsedMiB: number;
  /** Memory the Docker VM could still give out (MemAvailable in its /proc/meminfo; the host's on Linux). */
  vmFreeMiB: number;
  agentPanes: AgentPanes;
}

export interface HostDeps {
  /** The host's 1, 5 and 15 minute load averages. */
  loadAverages: () => readonly [number, number, number];
  /** The host's platform: Linux reads swap and memory from /proc/meminfo, anything else from macOS. */
  platform: NodeJS.Platform;
  /** Reads a text file of the host, such as /proc/meminfo; a fake stands in for it in its spec. */
  readFile: (path: string) => Promise<string>;
}

/** What the measurement asks of the host; a fake stands in for it in its spec. */
export interface HostReader {
  read(): Promise<HostSnapshot>;
}

export class HostConditions implements HostReader {
  constructor(
    private readonly runner: Runner,
    /** A container of the k3d cluster, whose /proc/meminfo is the Docker VM's. */
    private readonly serverContainer: string,
    private readonly deps: HostDeps,
  ) {}

  async read(): Promise<HostSnapshot> {
    const [oneMinute, fiveMinute, fifteenMinute] = this.deps.loadAverages();
    const { swapUsedMiB, vmFreeMiB } =
      this.deps.platform === "linux"
        ? await this.linuxMemory()
        : await this.macosMemory();
    return {
      load: { oneMinute, fiveMinute, fifteenMinute },
      swapUsedMiB,
      vmFreeMiB,
      agentPanes: await this.agentPanes(),
    };
  }

  /** macOS: swap from sysctl, free memory from the Docker VM's /proc/meminfo. */
  private async macosMemory(): Promise<{
    swapUsedMiB: number;
    vmFreeMiB: number;
  }> {
    const swapUsedMiB = await this.readValue(
      "the macOS swap usage",
      "this measurement needs macOS",
      () => this.capture("sysctl", ["vm.swapusage"]),
      parseSwapUsedMiB,
    );
    const vmFreeMiB = await this.readValue(
      `the free memory of the Docker VM, read in ${this.serverContainer}`,
      `check that Docker is running and ${this.serverContainer} exists`,
      () =>
        this.capture("docker", [
          "exec",
          this.serverContainer,
          "cat",
          "/proc/meminfo",
        ]),
      parseMemAvailableMiB,
    );
    return { swapUsedMiB, vmFreeMiB };
  }

  /**
   * Linux: the host runs Docker itself, with no VM between, so its own
   * /proc/meminfo gives both the swap in use and the memory the containers can
   * still take. One read of the file feeds both parses.
   */
  private async linuxMemory(): Promise<{
    swapUsedMiB: number;
    vmFreeMiB: number;
  }> {
    return this.readValue(
      "the host's swap and memory in /proc/meminfo",
      "check that /proc/meminfo is readable on this host",
      () => this.deps.readFile(hostMeminfo),
      (meminfo) => ({
        swapUsedMiB: parseLinuxSwapUsedMiB(meminfo),
        vmFreeMiB: parseMemAvailableMiB(meminfo),
      }),
    );
  }

  /** A missing hc is reported by name and does not stop the measurement. */
  private async agentPanes(): Promise<AgentPanes> {
    try {
      const stdout = await this.capture("hc", ["ls", "--json"]);
      return { count: parseAgentPaneCount(stdout), source: agentPaneSource };
    } catch (error) {
      return {
        count: null,
        source: agentPaneSource,
        missing: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** The stdout of one read-only process. */
  private async capture(command: string, args: string[]): Promise<string> {
    const { stdout } = await this.runner.run(command, args, { capture: true });
    return stdout;
  }

  /** Runs one read and parses it; any failure names what was being read and how to fix it. */
  private async readValue<T>(
    subject: string,
    hint: string,
    read: () => Promise<string>,
    parse: (stdout: string) => T,
  ): Promise<T> {
    try {
      return parse(await read());
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`reading ${subject} failed: ${cause}; ${hint}`);
    }
  }
}

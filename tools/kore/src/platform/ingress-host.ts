import type { Runner } from "../runtime/index.js";
import { parseSwapUsedMiB } from "./footprint-parse.js";
import {
  parseAgentPaneCount,
  parseMemAvailableMiB,
} from "./ingress-host-parse.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// What the host was doing while the ingress measurement ran: load averages,
// swap, the Docker VM's free memory and how many agent panes were running. A
// result recorded on a busy machine is not comparable, so the measurement
// carries these before and after. Everything is read-only: `sysctl`, `docker
// exec ... cat /proc/meminfo` and `herdr agent list`.

/**
 * Where the agent pane count comes from: `herdr agent list`, the listing the
 * harness's own herdr poll reads. Every agent the herdr server lists is one pane.
 */
export const agentPaneSource = "herdr agent list";

/** The agent pane count, or the named reason it could not be read. */
export type AgentPanes =
  | { count: number; source: string }
  | { count: null; source: string; missing: string };

export interface HostSnapshot {
  load: { oneMinute: number; fiveMinute: number; fifteenMinute: number };
  swapUsedMiB: number;
  /** Memory the Docker VM could still give out (MemAvailable in its /proc/meminfo). */
  vmFreeMiB: number;
  agentPanes: AgentPanes;
}

export interface HostDeps {
  /** The host's 1, 5 and 15 minute load averages. */
  loadAverages: () => readonly [number, number, number];
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
    const swapUsedMiB = await this.readValue(
      "the macOS swap usage",
      "this measurement needs macOS",
      "sysctl",
      ["vm.swapusage"],
      parseSwapUsedMiB,
    );
    const vmFreeMiB = await this.readValue(
      `the free memory of the Docker VM, read in ${this.serverContainer}`,
      `check that Docker is running and ${this.serverContainer} exists`,
      "docker",
      ["exec", this.serverContainer, "cat", "/proc/meminfo"],
      parseMemAvailableMiB,
    );
    return {
      load: { oneMinute, fiveMinute, fifteenMinute },
      swapUsedMiB,
      vmFreeMiB,
      agentPanes: await this.agentPanes(),
    };
  }

  /** A missing herdr is reported by name and does not stop the measurement. */
  private async agentPanes(): Promise<AgentPanes> {
    try {
      const { stdout } = await this.runner.run("herdr", ["agent", "list"], {
        capture: true,
      });
      return { count: parseAgentPaneCount(stdout), source: agentPaneSource };
    } catch (error) {
      return {
        count: null,
        source: agentPaneSource,
        missing: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Runs one read; any failure names what was being read and how to fix it. */
  private async readValue<T>(
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

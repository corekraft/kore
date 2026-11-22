// A scratch hc core for the integration specs (plan 16, Step 2). The spec starts
// it under its own HC_SESSION and XDG dirs in a temp root, and stops it. Every
// hc call gets that environment whole, so the owner's core, HC_TERMINAL_ID and
// HC_SOCKET never reach it. Nothing here runs hc without the scratch session.
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ProcessRunner,
  type Runner,
  type RunResult,
} from "../../src/runtime/index.js";
import { HcTerminals, type Terminals } from "../../src/terminal/index.js";

/** The exit code ProcessRunner gives when a command cannot start. */
const CANNOT_START = 127;

/** Why this tier cannot run here, or undefined when hc is on PATH. */
export async function hcMissingReason(): Promise<string | undefined> {
  const probe = await new ProcessRunner().run("hc", ["--version"], {
    env: { PATH: process.env.PATH ?? "" },
  });
  return probe.code === CANNOT_START
    ? "hc is not on PATH, so the hc integration specs are skipped: install the pinned hc 0.1.21 (docs/operations/hc-pin.md) to run them"
    : undefined;
}

export interface ScratchCore {
  /** The scratch HC_SESSION. No other core is reached with it. */
  readonly session: string;
  /** A directory inside the temp root, for a terminal to start in. */
  readonly dir: string;
  /** The whole environment every hc call runs with. */
  readonly env: Readonly<Record<string, string>>;
  /** A Runner that gives each call the scratch environment. */
  readonly runner: Runner;
  /** The Terminals port over the scratch core. */
  readonly terminals: Terminals;
  /** Runs hc under the scratch environment, and returns what it printed. */
  hc(args: readonly string[]): Promise<RunResult>;
  /** Starts the scratch core. A failed start throws with hc's own words. */
  start(): Promise<void>;
  /** Kills the live terminals and removes the finished ones on the scratch core. */
  reset(): Promise<void>;
  /** Ends the live terminals, stops the scratch core, and removes the temp root. */
  dispose(): Promise<void>;
}

/** The scratch environment: its own session and XDG dirs under root, and nothing of the caller's hc. */
async function environmentUnder(root: string, session: string) {
  for (const sub of [
    "home",
    "config",
    "state",
    "data",
    "cache",
    "run",
    "work",
  ]) {
    await mkdir(join(root, sub));
  }
  return {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    HC_SESSION: session,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_RUNTIME_DIR: join(root, "run"),
  } satisfies Record<string, string>;
}

/** A scratch core that is not started yet. Its temp root is /tmp, short enough for hc's socket path. */
export async function scratchCore(): Promise<ScratchCore> {
  const root = await mkdtemp("/tmp/kore-hc-");
  const session = "kore-it-" + randomBytes(4).toString("hex");
  const dir = join(root, "work");
  const env = await environmentUnder(root, session);
  const runner: Runner = {
    run: (command, args, options = {}) =>
      new ProcessRunner().run(command, args, { ...options, env }),
  };
  const terminals = new HcTerminals({ runner, env: {} });
  let started = false;

  const hc = (args: readonly string[]) => runner.run("hc", [...args]);

  /** Kills each live terminal and removes each one that is finished, so no test sees another's. */
  async function reset(): Promise<void> {
    const listed = await hc(["ls", "--json", "--all"]);
    const all = JSON.parse(listed.stdout || "{}") as {
      terminals?: { address: string; state: string }[];
    };
    for (const terminal of all.terminals ?? []) {
      if (terminal.state === "live") {
        await hc(["kill", "--json", terminal.address]);
      }
      await hc(["rm", "--json", terminal.address]);
    }
  }

  return {
    session,
    dir,
    env,
    runner,
    terminals,
    hc,
    reset,
    async start() {
      const result = await hc(["server", "start", "--json"]);
      if (result.code !== 0) {
        throw new Error(
          "hc server start under " +
            session +
            " failed: " +
            result.stderr +
            result.stdout,
        );
      }
      started = true;
    },
    async dispose() {
      try {
        if (started) {
          await reset();
          await hc(["server", "stop", "--json"]);
          started = false;
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

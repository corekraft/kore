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

/** Both hc specs print this as their skip title. It runs on hosts with hc, not on CI, which has none. */
export const SKIP_REASON =
  "SKIPPED, NOT RUN: hc is not on PATH, so the hc integration gate did not run on this host; it runs on hosts with the pinned hc 0.1.21 (docs/operations/hc-pin.md)";

/** Why this tier cannot run here, or undefined when hc is on PATH. */
export async function hcMissingReason(): Promise<string | undefined> {
  const probe = await new ProcessRunner().run("hc", ["--version"], {
    env: { PATH: process.env.PATH ?? "" },
  });
  return probe.code === CANNOT_START ? SKIP_REASON : undefined;
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
  /** Kills the live terminals and removes the finished ones on the scratch core. */
  reset(): Promise<void>;
  /** Starts the scratch core. A failed start throws with hc's own words. */
  start(): Promise<void>;
  /** Stops the scratch core. Throws when hc stop exits non-zero, or when its holder process is still running. */
  stop(): Promise<void>;
  /** Resets, stops, and removes the temp root. Rethrows a failed stop after the root is gone. */
  dispose(): Promise<void>;
}

/** The environment that scratch core runs under: its own session and XDG dirs under root, and nothing of the caller's hc. */
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

/** The holder process hc reports for the live terminals, or undefined when it reports none. */
async function holderOf(hc: ScratchCore["hc"]): Promise<number | undefined> {
  const status = await hc(["server", "status", "--json"]);
  const holder = (
    JSON.parse(status.stdout || "{}") as { holder?: { pid?: number } | null }
  ).holder;
  return holder?.pid;
}

/** True while a process with this pid exists. EPERM means it exists under another user. */
function stillRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Polls for a few seconds, since a holder exits a moment after its core stops. */
async function holderGone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!stillRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** Kills each live terminal and removes each one that is finished, so no test sees another's. */
async function resetUnder(hc: ScratchCore["hc"]): Promise<void> {
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

/** Stops the core, then checks that the holder it reported before the stop is gone. */
async function stopUnder(
  hc: ScratchCore["hc"],
  session: string,
  holder: number | undefined,
): Promise<void> {
  const stopped = await hc(["server", "stop", "--json"]);
  if (stopped.code !== 0) {
    throw new Error(
      "hc server stop under " +
        session +
        " exited " +
        stopped.code +
        ": " +
        stopped.stderr +
        stopped.stdout,
    );
  }
  if (holder !== undefined && !(await holderGone(holder))) {
    throw new Error(
      "holder pid " +
        holder +
        " is still running after hc server stop under " +
        session,
    );
  }
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

  return {
    session,
    dir,
    env,
    runner,
    terminals,
    hc,
    reset: () => resetUnder(hc),
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
    async stop() {
      if (started) {
        const holder = await holderOf(hc);
        started = false;
        await stopUnder(hc, session, holder);
      }
    },
    async dispose() {
      let failure: unknown;
      try {
        if (started) {
          const holder = await holderOf(hc);
          await resetUnder(hc);
          started = false;
          await stopUnder(hc, session, holder);
        }
      } catch (error) {
        failure = error;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
      if (failure !== undefined) {
        throw failure;
      }
    },
  };
}

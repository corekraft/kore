import { dirname, join, resolve } from "node:path";
import { CommandError, mainRoot } from "../runtime/index.js";
import type { CliDeps } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";

export interface Handoff {
  /** A directory this call creates (mode 0700) and removes; it must not be shared. */
  dir: string;
  pane: string;
  token: string;
  /** How long to wait for the pane to read the FIFO. */
  timeoutMs: number;
}

const DRAIN_MS = 2000;
export const HANDOFF_TIMEOUT_MS = 10_000;
const HANDOFF_DIR = ".kore/state/handoff";

/** Under the main checkout's runtime state, like the session registry, so no worktree (or its sandbox) shares it. */
export async function handoffDir(deps: CliDeps, name: string): Promise<string> {
  const main = await mainRoot(deps);
  if (main === undefined) {
    throw new CommandError(
      "Cannot find the main checkout to hand a token over in. Run inside the repository or set KORE_ROOT to its root.",
    );
  }
  return resolve(main, HANDOFF_DIR, name);
}

// The shell's own redirection opens the FIFO and blocks until the other end opens; dd does not on macOS.
const WRITE = ["-c", 'exec cat > "$1"', "sh"];
const DRAIN = ["-c", 'exec cat < "$1" > /dev/null', "sh"];

/** `'…'` for a POSIX shell, with embedded quotes closed, escaped and reopened. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function create(deps: CliDeps, dir: string, fifo: string) {
  const steps: [string, string[]][] = [
    ["rm", ["-rf", dir]],
    ["mkdir", ["-p", dirname(dir)]],
    ["mkdir", ["-m", "700", dir]],
    ["mkfifo", ["-m", "600", fifo]],
  ];
  for (const [command, args] of steps) {
    const made = await deps.runner.run(command, args);
    if (made.code !== 0) {
      return `${command} ${args.join(" ")} failed: ${describeFailure(made)}`;
    }
  }
  return undefined;
}

/**
 * Puts a token into a pane's GH_TOKEN without argv or disk. A 0600 FIFO in a
 * 0700 directory carries it: the pane's shell is told only the FIFO's path,
 * the token goes in on stdin of the one process that writes the FIFO, and the
 * FIFO is removed after that single read, or on timeout. An error message, or
 * undefined once the pane has the token.
 */
export async function handOff(
  deps: CliDeps,
  { dir, pane, token, timeoutMs }: Handoff,
): Promise<string | undefined> {
  const fifo = join(dir, "token");
  try {
    const failed = await create(deps, dir, fifo);
    if (failed !== undefined) {
      return failed;
    }
    // Opening a FIFO for writing blocks until the pane opens it for reading.
    const written = deps.runner.run("sh", WRITE.concat(fifo), {
      input: token,
      timeoutMs,
    });
    const told = await deps.runner.run("herdr", [
      "pane",
      "run",
      pane,
      `export GH_TOKEN="$(cat ${shellQuote(fifo)})"`,
    ]);
    if (told.code !== 0) {
      // Nobody will read: open the read end so the writer does not wait out its timeout.
      await deps.runner.run("sh", DRAIN.concat(fifo), {
        timeoutMs: DRAIN_MS,
      });
      await written;
      return `herdr pane run failed to tell ${pane} where to read its token: ${describeFailure(told)}`;
    }
    const result = await written;
    return result.code === 0
      ? undefined
      : `The pane ${pane} did not read its token within ${timeoutMs} ms (${describeFailure(result)}). Close it with \`herdr pane close ${pane}\`, then spawn again.`;
  } finally {
    await deps.runner.run("rm", ["-rf", dir]);
  }
}

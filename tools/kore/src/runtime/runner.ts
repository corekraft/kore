import { spawn } from "node:child_process";
import { killGroup, liveGroups } from "./live-groups.js";
import { Watchdog, type Signal } from "./watchdog.js";

export interface RunOptions {
  cwd?: string;
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
  stdin?: "inherit" | "ignore";
  input?: string;
  /**
   * A kubeconfig held in memory and handed to the child as `KUBECONFIG=/dev/fd/N`
   * through a pipe, so credentials in it never reach disk. The child reads the
   * descriptor once; it cannot be combined with `input`.
   */
  kubeconfig?: string;
  /** Aborting terminates the running process (SIGTERM) and rejects the run. */
  signal?: AbortSignal;
  /**
   * Kills the process after this many milliseconds (SIGTERM, then SIGKILL after
   * the runner's grace period) and rejects with a `CommandTimeoutError`. Zero
   * disables the runner's default for this call.
   */
  timeoutMs?: number;
}
export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}
export interface Runner {
  run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult>;
}

export class CommandError extends Error {
  constructor(
    public command: string,
    public args: readonly string[],
    public result: RunResult,
  ) {
    super(
      `${command} ${args.join(" ")} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

/** A command killed for running past its timeout; the message names the cause. */
export class CommandTimeoutError extends CommandError {
  constructor(
    command: string,
    args: readonly string[],
    result: RunResult,
    public timeoutMs: number,
    public escalatedToKill: boolean,
  ) {
    super(command, args, result);
    this.name = "CommandTimeoutError";
    const output = result.stderr.trim() || result.stdout.trim();
    this.message =
      `${command} ${args.join(" ")} timed out after ${timeoutMs}ms; it hung rather than failed, ` +
      (escalatedToKill
        ? "did not exit on SIGTERM, and was killed with SIGKILL"
        : "and stopped on SIGTERM") +
      `. Check what it was waiting on, then rerun.` +
      (output ? ` Last output: ${output}` : "");
  }
}

export interface ProcessRunnerOptions {
  /** Applied to every command that sets no `timeoutMs`; unset means none. */
  defaultTimeoutMs?: number;
  /** How long a timed-out process gets after SIGTERM before SIGKILL. */
  killGraceMs?: number;
  /** Test seam: replaces `child_process.spawn`. */
  spawn?: typeof spawn;
  /** Test seam: replaces signalling a process group (`process.kill(-pid)`). */
  signalGroup?: (pid: number, signal: Signal) => void;
}

// Bash exposes the piped kubeconfig as /dev/fd/N, which stays open across exec.
const feedKubeconfig = 'KUBECONFIG=<(cat) exec "$0" "$@"';

/**
 * Reports a failure of the bash wrapper as the caller's own command: the
 * original command and arguments, and ENOENT when bash could not find it.
 */
function unwrapped(
  error: unknown,
  command: string,
  args: readonly string[],
): unknown {
  if (!(error instanceof CommandError)) {
    return error;
  }
  if (error.result.code === 127 && /not found/i.test(error.result.stderr)) {
    return Object.assign(new Error(`spawn ${command} ENOENT`), {
      code: "ENOENT",
      errno: -2,
      syscall: `spawn ${command}`,
      path: command,
    });
  }
  return new CommandError(command, args, error.result);
}

/**
 * Spawns the child with its output captured into `output`. Children that
 * share the terminal stay in Kore's process group, so the terminal's own
 * signals still reach them; every other child leads a group of its own, and
 * `send` signals that whole group.
 */
function launch(
  runner: ProcessRunnerOptions,
  command: string,
  args: readonly string[],
  options: RunOptions,
) {
  const detached = options.capture !== false && options.stdin !== "inherit";
  const child = (runner.spawn ?? spawn)(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached,
    stdio: [
      options.input === undefined ? (options.stdin ?? "ignore") : "pipe",
      options.capture === false ? "inherit" : "pipe",
      options.capture === false ? "inherit" : "pipe",
    ],
  });
  const pid = child.pid;
  const groupSignal = runner.signalGroup ?? killGroup;
  const send = (signal: Signal) =>
    detached && pid !== undefined
      ? groupSignal(pid, signal)
      : void child.kill(signal);
  if (detached && pid !== undefined) {
    liveGroups.add(pid);
    child.on("exit", () => liveGroups.delete(pid));
  }
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk: Buffer) => {
    output.stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output.stderr += chunk.toString();
  });
  if (options.input !== undefined) {
    child.stdin?.end(options.input);
  }
  return { child, send, output };
}

export class ProcessRunner implements Runner {
  constructor(private readonly options: ProcessRunnerOptions = {}) {}

  private async runWithKubeconfig(
    command: string,
    args: readonly string[],
    kubeconfig: string,
    rest: RunOptions,
  ): Promise<RunResult> {
    try {
      return await this.run("bash", ["-c", feedKubeconfig, command, ...args], {
        ...rest,
        input: kubeconfig,
      });
    } catch (error) {
      throw unwrapped(error, command, args);
    }
  }

  async run(
    command: string,
    args: readonly string[],
    options: RunOptions = {},
  ): Promise<RunResult> {
    if (options.kubeconfig !== undefined && options.input !== undefined) {
      throw new Error("a kubeconfig and stdin input cannot be combined");
    }
    if (options.kubeconfig !== undefined) {
      const { kubeconfig, ...rest } = options;
      return await this.runWithKubeconfig(command, args, kubeconfig, rest);
    }
    return await this.execute(command, args, options);
  }

  private execute(
    command: string,
    args: readonly string[],
    options: RunOptions,
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const { child, send, output } = launch(
        this.options,
        command,
        args,
        options,
      );
      const terminate = () => send("SIGTERM");
      const watchdog = new Watchdog({
        timeoutMs: options.timeoutMs ?? this.options.defaultTimeoutMs ?? 0,
        graceMs: this.options.killGraceMs ?? 5000,
        send,
        settled: () => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          options.signal?.removeEventListener("abort", terminate);
          reject(
            new CommandTimeoutError(
              command,
              args,
              { ...output, code: 1 },
              watchdog.timeoutMs,
              watchdog.escalated(),
            ),
          );
        },
      });
      if (options.signal?.aborted) {
        terminate();
      } else {
        options.signal?.addEventListener("abort", terminate, { once: true });
      }
      child.on("error", (error) => {
        watchdog.clear();
        reject(error);
      });
      child.on("exit", () => watchdog.noteExit());
      child.on("close", (code) => {
        if (watchdog.timedOut()) {
          return; // the watchdog settles a timed-out run on exit plus grace
        }
        watchdog.clear();
        options.signal?.removeEventListener("abort", terminate);
        const result = { ...output, code: code ?? 1 };
        if (result.code === 0) {
          resolve(result);
        } else {
          reject(new CommandError(command, args, result));
        }
      });
    });
  }
}

export class RecordingRunner implements Runner {
  calls: { command: string; args: readonly string[]; options?: RunOptions }[] =
    [];
  constructor(private readonly responses: RunResult[] = []) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    return this.responses.shift() ?? { stdout: "", stderr: "", code: 0 };
  }
}

/**
 * A runner whose every command is cancelled by `signal`: one abort stops
 * whichever commands are running and any started afterwards.
 */
export function withSignal(inner: Runner, signal: AbortSignal): Runner {
  return {
    run: (command, args, options) =>
      inner.run(command, args, { ...options, signal }),
  };
}

import { spawn, type ChildProcess } from "node:child_process";

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
      `${command} ${args.join(" ")} timed out after ${timeoutMs}ms and was killed` +
      (escalatedToKill
        ? " with SIGKILL (it ignored SIGTERM)"
        : " with SIGTERM") +
      `; the process hung rather than failed. Check what it was waiting on, then rerun.` +
      (output ? ` Last output: ${output}` : "");
  }
}

export interface ProcessRunnerOptions {
  /** Applied to every command that sets no `timeoutMs`; unset means none. */
  defaultTimeoutMs?: number;
  /** How long a timed-out process gets after SIGTERM before SIGKILL. */
  killGraceMs?: number;
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
 * Starts the SIGTERM-then-SIGKILL clock for a child. A zero `timeoutMs` never
 * fires. Read the outcome through `timedOut()` and `escalated()` once it exits.
 */
function startWatchdog(
  child: ChildProcess,
  timeoutMs: number,
  graceMs: number,
) {
  let timedOut = false,
    escalated = false;
  let killTimer: NodeJS.Timeout | undefined;
  const timeoutTimer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => {
            escalated = true;
            child.kill("SIGKILL");
          }, graceMs);
        }, timeoutMs)
      : undefined;
  return {
    timeoutMs,
    timedOut: () => timedOut,
    escalated: () => escalated,
    clear: () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
    },
  };
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
    return await new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: [
          options.input === undefined ? (options.stdin ?? "ignore") : "pipe",
          options.capture === false ? "inherit" : "pipe",
          options.capture === false ? "inherit" : "pipe",
        ],
      });
      let stdout = "",
        stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      if (options.input !== undefined) {
        child.stdin?.end(options.input);
      }
      const terminate = () => child.kill("SIGTERM");
      const watchdog = startWatchdog(
        child,
        options.timeoutMs ?? this.options.defaultTimeoutMs ?? 0,
        this.options.killGraceMs ?? 5000,
      );
      if (options.signal?.aborted) {
        terminate();
      } else {
        options.signal?.addEventListener("abort", terminate, { once: true });
      }
      child.on("error", (error) => {
        watchdog.clear();
        reject(error);
      });
      child.on("close", (code) => {
        watchdog.clear();
        options.signal?.removeEventListener("abort", terminate);
        const result = { stdout, stderr, code: code ?? 1 };
        if (watchdog.timedOut()) {
          reject(
            new CommandTimeoutError(
              command,
              args,
              result,
              watchdog.timeoutMs,
              watchdog.escalated(),
            ),
          );
        } else if (result.code === 0) {
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

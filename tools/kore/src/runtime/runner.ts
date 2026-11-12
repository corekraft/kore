import { spawn } from "node:child_process";

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

// Bash exposes the piped kubeconfig as /dev/fd/N, which stays open across exec.
const feedKubeconfig = 'KUBECONFIG=<(cat) exec "$0" "$@"';

export class ProcessRunner implements Runner {
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
      return await this.run("bash", ["-c", feedKubeconfig, command, ...args], {
        ...rest,
        input: kubeconfig,
      });
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
      if (options.signal?.aborted) {
        terminate();
      } else {
        options.signal?.addEventListener("abort", terminate, { once: true });
      }
      child.on("error", reject);
      child.on("close", (code) => {
        options.signal?.removeEventListener("abort", terminate);
        const result = { stdout, stderr, code: code ?? 1 };
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

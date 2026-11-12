import { spawn } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  input?: string;
  /** The child's whole environment; the parent's when omitted. */
  env?: Record<string, string>;
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

/** Runs real processes. A command that cannot start resolves with a non-zero code. */
export class ProcessRunner implements Runner {
  async run(
    command: string,
    args: readonly string[],
    options: RunOptions = {},
  ): Promise<RunResult> {
    return await new Promise((resolve) => {
      const child = spawn(command, [...args], {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        stdio: [
          options.input === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        resolve({ stdout, stderr: error.message, code: 127 });
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, code: code ?? 1 });
      });
      if (options.input !== undefined) {
        child.stdin?.end(options.input);
      }
    });
  }
}

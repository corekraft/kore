import { spawn } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
  stdin?: "inherit" | "ignore";
  input?: string;
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

export class ProcessRunner implements Runner {
  async run(
    command: string,
    args: readonly string[],
    options: RunOptions = {},
  ): Promise<RunResult> {
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
      if (options.input !== undefined) child.stdin?.end(options.input);
      child.on("error", reject);
      child.on("close", (code) => {
        const result = { stdout, stderr, code: code ?? 1 };
        if (result.code === 0) resolve(result);
        else reject(new CommandError(command, args, result));
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

import type { RunOptions, RunResult, Runner } from "./runner.js";

export interface FakeResponse {
  match: (command: string, args: readonly string[]) => boolean;
  result: Partial<RunResult>;
}
export interface RecordedCall {
  command: string;
  args: readonly string[];
  options: RunOptions | undefined;
}

/** Records every call; answers from the first matching response, else success. */
export class FakeRunner implements Runner {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly responses: readonly FakeResponse[] = []) {}

  run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, options });
    const hit = this.responses.find((r) => r.match(command, args));
    return Promise.resolve({ stdout: "", stderr: "", code: 0, ...hit?.result });
  }
}

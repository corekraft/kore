import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Where a streamed command runs, and the whole environment it gets; the parent's when none is given. */
export interface LineStreamOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Runs a command and yields each line it prints, as it prints it. A Runner returns only when its command ends,
 * so it cannot follow a command that never ends, such as hc events. Stopping early kills the command, and a
 * command that fails throws with its exit code and its own stderr.
 */
export interface LineStream {
  lines(
    command: string,
    args: readonly string[],
    options?: LineStreamOptions,
  ): AsyncIterable<string>;
}

/** How a command ended: its exit code, or the error that stopped it from starting. */
type Ending = { code: number | null } | { error: Error };

/** The LineStream over real processes, with node's spawn and readline. */
export class ProcessLineStream implements LineStream {
  async *lines(
    command: string,
    args: readonly string[],
    options: LineStreamOptions = {},
  ): AsyncGenerator<string> {
    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout === null) {
      throw new Error(`${command} started without a stdout to read`);
    }
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const ending = new Promise<Ending>((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code) => resolve({ code }));
    });
    const lines = createInterface({ input: child.stdout });
    let completed = false;
    try {
      for await (const line of lines) {
        yield line;
      }
      completed = true;
    } finally {
      lines.close();
      // Only a reader that stopped early kills the command. Output that ends first is a normal end, and its exit code may not be set yet.
      if (!completed && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
    const end = await ending;
    if ("error" in end) {
      throw new Error(`${command} could not start: ${end.error.message}`);
    }
    if (end.code !== 0) {
      const said = stderr.trim();
      throw new Error(
        `${command} ${args.join(" ")} ended with exit code ${end.code}${said === "" ? "" : `: ${said}`}`,
      );
    }
  }
}

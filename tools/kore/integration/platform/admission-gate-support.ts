// Fakes for the application admission gate integration specs.
import { CommandError, type Runner } from "../../src/runtime/index.js";

export interface Call {
  command: string;
  args: readonly string[];
  input?: string | undefined;
}

export function gateRunner(
  calls: Call[],
  gate?: unknown,
  stderr?: string,
): Runner {
  return {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      if (stderr !== undefined) {
        throw new CommandError(command, args, { stdout: "", stderr, code: 1 });
      }
      return {
        stdout: gate === undefined ? "" : JSON.stringify(gate),
        stderr: "",
        code: 0,
      };
    },
  };
}

export function liveGate(state: string, generation: string) {
  return { spec: { parameters: { state, generation } } };
}

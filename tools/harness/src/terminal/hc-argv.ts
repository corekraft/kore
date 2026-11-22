import { terminalError, type RunSpec, type TerminalError } from "./port.js";

/** The kernel caps one argument at 128 KiB, so a longer one cannot be passed. */
const MAX_ARG_BYTES = 128 * 1024;

/** A character that makes hc run a lone argv element through sh -c. */
const SHELL_SIGN = /[\s;&|<>$\x60'"\\()*?[\]{}~#!]/;

/** Refuses a spec that hc would start wrongly, before hc runs at all. */
export function refuseRun(spec: RunSpec): TerminalError | undefined {
  if (Object.keys(spec.env ?? {}).length > 0) {
    return terminalError(
      "invalid-spec",
      "hc run cannot set a terminal's env, and a secret never goes in argv",
      "pass no env: the launch wrapper inside the terminal makes the role's token (plan 16, Decisions 6)",
    );
  }
  if (spec.argv.length === 0) {
    return terminalError(
      "invalid-spec",
      "hc run needs a program to start",
      "pass the program as argv[0]",
    );
  }
  const [only] = spec.argv;
  if (spec.argv.length === 1 && SHELL_SIGN.test(only ?? "")) {
    return terminalError(
      "invalid-spec",
      "hc would run " + JSON.stringify(only) + " through sh -c",
      "pass the program and each argument as its own argv element",
    );
  }
  for (const arg of spec.argv) {
    const bytes = Buffer.byteLength(arg);
    if (bytes > MAX_ARG_BYTES) {
      return terminalError(
        "invalid-spec",
        "an argv element is " +
          bytes +
          " bytes, over the " +
          MAX_ARG_BYTES +
          "-byte limit for one argument",
        "write the brief to a file and pass its path (plan 16, Step 3)",
      );
    }
  }
  return undefined;
}

import type { Runner } from "../runtime/index.js";
import { terminalError, type TerminalError } from "./port.js";

/** The pinned hc version (docs/operations/hc-pin.md). */
export const HC_VERSION = "0.1.21";

const INSTALL_HINT =
  "install the pinned hc " +
  HC_VERSION +
  ' with "hc update --version ' +
  HC_VERSION +
  '" (or "hc update --from <file>" for the exact binary), then confirm with "hc --version"';

let check: Promise<TerminalError | undefined> | undefined;

/**
 * Compares hc --version with the pin. It runs once per process, and a failure
 * is kept too, so every later call fails the same way without running hc again.
 */
export function checkHcVersion(
  runner: Runner,
): Promise<TerminalError | undefined> {
  check ??= compare(runner);
  return check;
}

async function compare(runner: Runner): Promise<TerminalError | undefined> {
  const result = await runner.run("hc", ["--version"]);
  if (result.code !== 0) {
    return terminalError(
      "unavailable",
      "hc is not installed or not on PATH: hc --version exited with code " +
        result.code,
      INSTALL_HINT,
    );
  }
  const found = result.stdout.trim();
  if (found === "hc " + HC_VERSION) {
    return undefined;
  }
  return terminalError(
    "unavailable",
    found + " is installed, but kore pins hc " + HC_VERSION,
    INSTALL_HINT,
  );
}

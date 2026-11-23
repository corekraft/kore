// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// Parsers for the host conditions the ingress measurement records beside its
// result: the Docker VM's available memory and the running agent pane count.
// Unreadable output names what was read, so a failure says what to check.

/** The VM's available memory (MiB) from the MemAvailable line of `/proc/meminfo`. */
export function parseMemAvailableMiB(stdout: string): number {
  const available = /^MemAvailable:\s+(\d+)\s*kB/m.exec(stdout);
  if (!available) {
    throw new Error(
      `unreadable VM memory report ${JSON.stringify(stdout.trim())}`,
    );
  }
  return Math.round(Number(available[1]) / 1024);
}

/** The host's swap in use (MiB) on Linux: SwapTotal less SwapFree in `/proc/meminfo`. */
export function parseLinuxSwapUsedMiB(stdout: string): number {
  const total = /^SwapTotal:\s+(\d+)\s*kB/m.exec(stdout);
  const free = /^SwapFree:\s+(\d+)\s*kB/m.exec(stdout);
  if (!total || !free) {
    throw new Error(
      `unreadable host swap report ${JSON.stringify(stdout.trim())}`,
    );
  }
  return Math.round((Number(total[1]) - Number(free[1])) / 1024);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The agent that `hc ls` names for a terminal running a claude session. */
const CLAUDE_AGENT = "claude-code";

/** The number of claude sessions `hc ls --json` lists; zero is an answer, not a missing source. */
export function parseAgentPaneCount(stdout: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      "hc ls did not print JSON; run `hc ls --json` by hand and check the hc version",
    );
  }
  const terminals = isRecord(parsed) ? parsed["terminals"] : undefined;
  if (!Array.isArray(terminals)) {
    throw new Error(
      "hc ls printed no terminal list (.terminals); the hc version may have changed its output",
    );
  }
  return terminals.filter(
    (terminal) => isRecord(terminal) && terminal["agent"] === CLAUDE_AGENT,
  ).length;
}

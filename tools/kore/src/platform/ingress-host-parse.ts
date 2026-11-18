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

/** The number of agents `herdr agent list` prints; zero is an answer, not a missing source. */
export function parseAgentPaneCount(stdout: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      "herdr agent list did not print JSON; run `herdr agent list` by hand and check the herdr version",
    );
  }
  const agents = (parsed as { result?: { agents?: unknown } } | null)?.result
    ?.agents;
  if (!Array.isArray(agents)) {
    throw new Error(
      "herdr agent list printed no agent list (.result.agents); the herdr version may have changed its output",
    );
  }
  return agents.length;
}

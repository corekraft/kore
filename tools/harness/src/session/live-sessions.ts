import type { Runner } from "../runtime/index.js";

/** How many agents herdr lists right now, or undefined when herdr cannot say. Never a guessed zero. */
export async function liveSessionCount(
  runner: Runner,
): Promise<number | undefined> {
  try {
    const found = await runner.run("herdr", ["agent", "list"]);
    if (found.code !== 0) {
      return undefined;
    }
    const agents = (
      JSON.parse(found.stdout) as { result?: { agents?: unknown } } | null
    )?.result?.agents;
    return Array.isArray(agents) ? agents.length : undefined;
  } catch {
    return undefined;
  }
}

// Fakes for the context hook's unit specs: each read resolves to nothing unless a spec overrides it.
import type { ContextDeps } from "./context.js";

export function deps(over: Partial<ContextDeps> = {}): ContextDeps {
  return {
    readAgents: () => Promise.resolve(""),
    readPlans: () => Promise.resolve({}),
    readJournals: () => Promise.resolve({}),
    sessionsSince: () => Promise.resolve(0),
    ...over,
  };
}

/** Deps whose plans are given and whose sessions-since count is fixed; the calls to sessionsSince are recorded. */
export function briefDeps(
  sessions: number,
  plans: Record<string, string> = {},
) {
  const calls: [string | null, string | undefined][] = [];
  return {
    calls,
    ...deps({
      readPlans: () => Promise.resolve(plans),
      sessionsSince: (date, current) => {
        calls.push([date, current]);
        return Promise.resolve(sessions);
      },
    }),
  };
}

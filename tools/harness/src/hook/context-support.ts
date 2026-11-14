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

import { hook } from "../hook/index.js";
import { session } from "../session/index.js";
import { skill } from "../skill/index.js";
import type { Command } from "../runtime/index.js";

/** The domains the agent host (hooks, sessions, skills) invokes. */
export const hostDomains: Record<string, Record<string, Command>> = {
  hook,
  session,
  skill,
};

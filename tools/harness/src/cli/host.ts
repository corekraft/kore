import { hook, promptSizeCommand } from "../hook/index.js";
import { session } from "../session/index.js";
import { skill } from "../skill/index.js";
import type { Command } from "../runtime/index.js";

/**
 * The domains the agent host (hooks, sessions, skills) invokes. `session prompt-size` (#1038)
 * is composed here: the command reads transcripts through the hook domain, which already
 * depends on the session barrel, so the session barrel must not import it.
 */
export const hostDomains: Record<string, Record<string, Command>> = {
  hook,
  session: { ...session, "prompt-size": promptSizeCommand },
  skill,
};

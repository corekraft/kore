import { restore, type SessionEvent } from "./context.js";
import { realContextDeps } from "./context-deps.js";
import { hookCommand } from "./io.js";

/**
 * SessionStart: the brief on a fresh session, the rules and open plan items
 * after compaction, nothing on resume. Input that is not a JSON object, or a
 * missing AGENTS.md, ends quietly with exit 0. Any other fault exits 1, which
 * the host shows, so a hook that breaks is never mistaken for one with nothing
 * to say.
 */
export const context = hookCommand(
  "context",
  "restate the rules and open plan items after compaction, or brief a fresh session (SessionStart)",
  async ({ deps, payload }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    if (Array.isArray(payload)) {
      return {};
    }
    let text: string;
    try {
      text = await restore(
        payload as SessionEvent,
        realContextDeps(deps, await deps.root()),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
    return text === ""
      ? {}
      : {
          stdout: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "SessionStart",
              additionalContext: text,
            },
          }),
        };
  },
  { faultCode: 1 },
);

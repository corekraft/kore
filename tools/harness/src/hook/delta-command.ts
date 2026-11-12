import { realDeltaDeps } from "./delta-deps.js";
import { update } from "./delta.js";
import { hookCommand } from "./io.js";

export const delta = hookCommand(
  "delta",
  "tell the agent what changed since its previous turn (UserPromptSubmit)",
  async ({ deps, payload }) => {
    const id = (payload as { session_id?: unknown } | null | undefined)
      ?.session_id;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return {};
    }
    const context = await update(id, realDeltaDeps(deps, await deps.root()));
    return context === ""
      ? {}
      : {
          stdout: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: context,
            },
          }),
        };
  },
);

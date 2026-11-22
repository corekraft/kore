import { realDeltaDeps } from "./delta-deps.js";
import { update } from "./delta.js";
import { hookCommand } from "./io.js";
import type { CommandHelp } from "../runtime/index.js";

const deltaHelp: CommandHelp = {
  purpose:
    "Tells the agent what changed since its previous turn: new commits on main, plan items ticked or added, locks taken or released, and journal operations started, finished or failed. The host adds the text to the prompt it is about to send.",
  when: "The host runs it on every UserPromptSubmit; run it by hand with a session_id on stdin to see what a session would be told.",
  whenNot:
    "To see the current state rather than what changed since the last prompt, use harness status.",
  flags: {
    strict:
      "A fault outside the comparison, such as no repository root, exits 1 instead of failing open with 0.",
  },
  examples: [
    {
      command: "harness hook delta",
      shows:
        "nothing on a session's first prompt, which only stores its baseline; after that, the changes since the previous prompt as additionalContext",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the changes are printed as additionalContext, or nothing changed; a payload with no session_id, a first prompt and a comparison that fails all print nothing",
    },
    {
      code: 1,
      meaning:
        "a fault outside the comparison, under --strict; without it the fault fails open with exit 0 and names itself on stderr",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "writes this session's snapshot under kore-delta in the repository's git directory, and removes other sessions' snapshots that were not written for 14 days",
  },
  seeAlso: ["status", "hook context"],
};

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
  { help: deltaHelp },
);

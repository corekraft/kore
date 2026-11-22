import { restore, type SessionEvent } from "./context.js";
import { realContextDeps } from "./context-deps.js";
import { hookCommand } from "./io.js";
import type { CommandHelp } from "../runtime/index.js";

const contextHelp: CommandHelp = {
  purpose:
    "Gives a session the context the host asks for at SessionStart. After a compaction it restates the AGENTS.md rules and the open items of each active plan; after a startup or clear it prints the session brief; after a resume it prints nothing.",
  when: "The host runs it on SessionStart for a startup, clear or compact, as the matcher in .claude/settings.json sets; run it by hand only to see what a session would be given.",
  whenNot:
    "To read the plans yourself, use harness plan active; this hook only writes context for a session and records nothing.",
  flags: {
    strict:
      "Accepted for uniformity: a fault already exits 1 here, so --strict changes nothing.",
  },
  examples: [
    {
      command: "harness hook context",
      shows:
        "the SessionStart JSON the host sends on stdin decides the output: nothing for a resume or empty input, the additionalContext for a startup, clear or compact",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the context is printed as the host's additionalContext, or there is nothing to say: a resume, input that is not a JSON object, or no AGENTS.md",
    },
    {
      code: 1,
      meaning:
        "a fault the hook cannot read past; the host shows it, so a broken hook is never silent",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads AGENTS.md, the plans, the operation journals and the session transcripts; it writes nothing and records no ledger event",
  },
  seeAlso: ["plan active", "hook record", "hook delta"],
};

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
  { faultCode: 1, help: contextHelp },
);

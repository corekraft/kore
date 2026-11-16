import type { Kind } from "./schema.js";

const SEND_KINDS: readonly Kind[] = ["session.send"];

const NAME = /^[\w.:/#@-]{1,128}$/;
const NAME_HINT = "must be 1-128 letters, digits or . _ : / # @ -";

/**
 * Who sent a pane message: the sender's role and session name, read from the caller's spawn
 * environment. Both are optional: a send from the main session names neither, and a send from
 * before these fields existed has neither.
 */
export const SENDER_RULES = [
  {
    field: "senderRole",
    check: (v: unknown) => typeof v === "string" && NAME.test(v),
    hint: NAME_HINT,
    kinds: SEND_KINDS,
    optional: true,
  },
  {
    field: "senderName",
    check: (v: unknown) => typeof v === "string" && NAME.test(v),
    hint: NAME_HINT,
    kinds: SEND_KINDS,
    optional: true,
  },
] as const;

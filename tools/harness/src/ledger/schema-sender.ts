import type { Kind } from "./schema.js";

const SEND_KINDS: readonly Kind[] = ["session.send"];

const NAME = /^[\w.:/#@-]{1,128}$/;
const NAME_HINT = "must be 1-128 letters, digits or . _ : / # @ -";

/**
 * Why the main session passed a case to the stronger session by a pane message (spec
 * #1031). The list is fixed: a reason outside it is refused, so no message text reaches
 * the ledger, and the handover count reads the reasons as written here.
 */
export const HANDOVER_REASONS = [
  "reserved-item",
  "needs-info-idea",
  "third-send-back",
  "owner-request",
  "flag-activation",
  "unmapped-message",
] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

/**
 * Who sent a pane message: the sender's role and session name, read from the caller's spawn
 * environment. Both are optional: a send from the main session names neither, and a send from
 * before these fields existed has neither. The handover reason (#1036) is optional on the same
 * kind: only a send that passed a case on names one.
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
  {
    field: "handover",
    check: (v: unknown) => HANDOVER_REASONS.includes(v as HandoverReason),
    hint: `must be one of ${HANDOVER_REASONS.join(", ")}`,
    kinds: SEND_KINDS,
    optional: true,
  },
] as const;

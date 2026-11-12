import type { PrView } from "./checks.js";

const PREFIX = "Sent back by the judge: ";

/** The PR comment that carries a send-back, naming the head commit it is about. */
export const sendBackBody = (reason: string, head: string): string =>
  `${PREFIX}${reason}\n\nhead ${head}`;

/** Whether the PR already carries this reason as a send-back for its current head, so a rerun posts nothing. */
export const hasSentBack = (view: PrView, reason: string): boolean =>
  view.comments.some((c) => c.body === sendBackBody(reason, view.headSha));

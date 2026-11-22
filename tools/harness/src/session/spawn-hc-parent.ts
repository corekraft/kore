import type { Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";

/** The label on the one live terminal the delivery loop runs in (plan 16, Grilled Decisions 2). */
export const DELIVERY_LABEL = "kore-delivery";

/** A session's parent, and whether it is the delivery terminal, whose children start with --no-notify. */
export interface Parent {
  parent: string;
  delivery: boolean;
}

const NONE =
  "No live terminal is labelled kore-delivery=1, so the session has no parent. Run session spawn from an hc terminal, or label the delivery terminal: hc label <id> kore-delivery=1.";

/**
 * The terminal a new session runs under: the caller's own terminal when it is one (HC_TERMINAL_ID), else the one live
 * terminal labelled kore-delivery=1. Zero or two such terminals are a refusal with a hint, never a guess.
 */
export async function resolveParent(
  terminals: Terminals,
): Promise<Parent | { error: string }> {
  const self = terminals.self();
  if (self !== undefined) {
    const caller = await terminals.get(self);
    if ("error" in caller) {
      return { error: hcMessage(caller) };
    }
    return { parent: self, delivery: caller.labels[DELIVERY_LABEL] === "1" };
  }
  const listed = await terminals.list({ labels: { [DELIVERY_LABEL]: "1" } });
  if ("error" in listed) {
    return { error: hcMessage(listed) };
  }
  const live = listed.filter((terminal) => terminal.state === "live");
  const [only] = live;
  if (only === undefined) {
    return { error: NONE };
  }
  if (live.length > 1) {
    const ids = live.map((terminal) => terminal.id).join(", ");
    return {
      error: `${live.length} live terminals are labelled kore-delivery=1 (${ids}), so the session has no one parent. Label all but one kore-delivery=0 with hc label <id> kore-delivery=0, so exactly one is kore-delivery=1.`,
    };
  }
  return { parent: only.id, delivery: true };
}

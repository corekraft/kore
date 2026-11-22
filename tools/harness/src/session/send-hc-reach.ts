import type { Terminal } from "../terminal/index.js";

/** How a session may reach a terminal: its parent, one of its children, or a sibling in its group (plan 16, Grilled Decisions 3). */
export type Reach = "parent" | "child" | "sibling";

/** The label a pair of sibling sessions share, set by session spawn --group. */
export const GROUP_LABEL = "group";

/** How `caller` may reach `target`, or undefined when a message to it is refused. */
export function reachOf(caller: Terminal, target: Terminal): Reach | undefined {
  if (target.id === caller.id) {
    return undefined;
  }
  if (target.id === caller.parent) {
    return "parent";
  }
  if (target.parent === caller.id) {
    return "child";
  }
  const group = caller.labels[GROUP_LABEL];
  return group !== undefined && target.labels[GROUP_LABEL] === group
    ? "sibling"
    : undefined;
}

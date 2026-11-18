// The idea states the ledger shows (#1033): each state is derived from events the ledger
// already holds, so no event kind is added and the tick records nothing new. The mapping
// below is the whole rule: a change is an event that sets a different state for an idea.
// Docs: docs/guides/contributor.md (harness wait)

import type { LedgerEvent } from "./schema.js";

/** The label that moves an issue's idea to approved, and the one that marks it as needing info. */
const APPROVED_LABEL = "ready-for-agent";
const NEEDS_INFO_LABEL = "needs-info";

/** An idea's state as the ledger shows it: the idea, the state, and when the event that set it occurred. */
export interface IdeaState {
  idea: string;
  state: string;
  at: string;
}

/** The idea and state one event sets, before its time is attached. */
type Set = Pick<IdeaState, "idea" | "state">;

/**
 * Keys an idea state to the idea it belongs to. An event that names its idea keys to that name;
 * an issue event keys to its issue as `#<n>`, the form a pull request's idea takes; a pull request
 * event with no idea of its own keys to the idea its pull request was opened for. An event with no
 * such key sets no state.
 */
function set(idea: string | undefined, state: string): Set | undefined {
  return idea === undefined ? undefined : { idea, state };
}

/** The state an event sets, or undefined when it sets none. */
function stateOf(
  event: LedgerEvent,
  ideaOfPull: ReadonlyMap<number, string>,
): Set | undefined {
  const viaPull =
    event.number === undefined ? undefined : ideaOfPull.get(event.number);
  switch (event.kind) {
    case "idea.filed":
      return set(event.idea, "filed");
    case "decision.routed":
      return set(event.idea, "reserved");
    case "pr.opened":
      return set(event.idea, "pr-open");
    case "pr.linked":
      return set(viaPull, "pr-open");
    case "send-back":
      return set(viaPull, "sent-back");
    case "pr.merged":
      return set(event.idea ?? viaPull, "merged");
    case "outcome":
      return event.label === undefined
        ? undefined
        : set(event.idea, event.label);
    case "issue.labelled": {
      if (event.number === undefined) {
        return undefined;
      }
      if (event.label === APPROVED_LABEL) {
        return set(`#${event.number}`, "approved");
      }
      if (event.label === NEEDS_INFO_LABEL) {
        return set(`#${event.number}`, "needs-info");
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Every idea state the events set, in the order they occurred. */
export function ideaStates(events: readonly LedgerEvent[]): IdeaState[] {
  const ideaOfPull = new Map<number, string>();
  for (const event of events) {
    if (
      (event.kind === "pr.opened" || event.kind === "pr.merged") &&
      event.idea !== undefined &&
      event.number !== undefined
    ) {
      ideaOfPull.set(event.number, event.idea);
    }
  }
  const ordered = [...events].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
  const states: IdeaState[] = [];
  for (const event of ordered) {
    const found = stateOf(event, ideaOfPull);
    if (found !== undefined) {
      states.push({ ...found, at: event.occurredAt });
    }
  }
  return states;
}

/**
 * The first change to an idea's state at or after `since`, in time order, or undefined when none
 * happens. A state the idea was already in when the wait began does not count, and a state first
 * seen after it does. With `only`, just that idea's changes count.
 */
export function firstIdeaStateChange(
  events: readonly LedgerEvent[],
  since: string,
  only?: string,
): IdeaState | undefined {
  const start = Date.parse(since);
  const current = new Map<string, string>();
  for (const state of ideaStates(events)) {
    if (Date.parse(state.at) < start) {
      current.set(state.idea, state.state);
      continue;
    }
    if (only !== undefined && state.idea !== only) {
      continue;
    }
    if (current.get(state.idea) !== state.state) {
      return state;
    }
    current.set(state.idea, state.state);
  }
  return undefined;
}

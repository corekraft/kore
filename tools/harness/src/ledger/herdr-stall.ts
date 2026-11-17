import { hasOpenBackground } from "./background.js";
import { hasOpenQuestion } from "./open-question.js";
import type { EventInput, LedgerEvent } from "./schema.js";

/**
 * How long a spawned pane may sit idle or gone with no RESULT before it is stalled
 * (#854). A placeholder: the owner tunes it from the flow report.
 */
export const STALL_SECONDS = 300;

const STATE_KINDS: readonly LedgerEvent["kind"][] = [
  "pane.spawned",
  "pane.busy",
  "pane.waiting",
  "pane.closed",
];

const time = (event: LedgerEvent) => Date.parse(event.occurredAt);

/**
 * The pane.stalled events the poll should append now (#854). A pane qualifies when a
 * session spawned it, its last state is idle or gone for at least STALL_SECONDS, it
 * printed no RESULT since it last started work, it has not been reported for this
 * idle stretch, no background command is open on it, and it does not wait on an open
 * reserved question (`questions` holds the decision.routed and owner.replied events).
 * Token-usage events are never read: silence in them is the flow report's own source.
 */
export function plannedStalls(
  herdr: readonly LedgerEvent[],
  claude: readonly LedgerEvent[],
  now: Date,
  questions: readonly LedgerEvent[],
): EventInput[] {
  const at = now.getTime();
  // A background command is marked on claude's tool.start; its end is the pane's RESULT,
  // which herdr records, so both are read. Token usage is left out.
  const marks = [...herdr, ...claude.filter((e) => e.kind === "tool.start")];
  const spawned = new Set(
    herdr
      .filter((e) => e.kind === "session.launch" && e.pane !== undefined)
      .map((e) => e.pane as string),
  );
  const planned: EventInput[] = [];
  for (const pane of spawned) {
    const states = herdr
      .filter((e) => e.pane === pane && STATE_KINDS.includes(e.kind))
      .sort((a, b) => time(a) - time(b));
    const last = states.at(-1);
    if (
      last === undefined ||
      (last.kind !== "pane.waiting" && last.kind !== "pane.closed")
    ) {
      continue;
    }
    const since = time(last);
    if (at - since < STALL_SECONDS * 1000) {
      continue;
    }
    const busy = states
      .filter((e) => e.kind === "pane.busy" || e.kind === "pane.spawned")
      .map(time)
      .at(-1);
    const printed = herdr.some(
      (e) =>
        e.pane === pane &&
        e.kind === "pane.finished" &&
        time(e) >= (busy ?? Number.NEGATIVE_INFINITY),
    );
    const reported = herdr.some(
      (e) => e.pane === pane && e.kind === "pane.stalled" && time(e) >= since,
    );
    if (
      printed ||
      reported ||
      hasOpenBackground(marks, pane, at) ||
      hasOpenQuestion(questions, pane, at)
    ) {
      continue;
    }
    planned.push({
      source: "herdr",
      kind: "pane.stalled",
      occurredAt: now.toISOString(),
      pane,
      ...(last.agent === undefined ? {} : { agent: last.agent }),
    });
  }
  return planned;
}

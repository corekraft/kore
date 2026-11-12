export interface BriefInput {
  task: string;
  name: string;
  /** The caller's pane id, read fresh from its own environment. */
  callerPane: string;
}

/** The exact completion command, filled in; `$HERDR_PANE_ID` is expanded by the session's shell. */
export function broadcastCommand(name: string, callerPane: string): string {
  return `herdr pane send-text ${callerPane} "[herdr:${name}] finished: RESULT <done|blocked>; summary in pane $HERDR_PANE_ID" && herdr pane send-keys ${callerPane} enter`;
}

/** The task plus the three things every brief carries: caller pane, session name, broadcast. */
export function buildBrief({ task, name, callerPane }: BriefInput): string {
  return [
    task,
    "",
    `You are ${name}; your session name is ${name}.`,
    `When you finish, broadcast to pane \`${callerPane}\`. Print your summary and a final line with the word RESULT, a colon, then done or blocked. Then, as your very last action, run this one line with the outcome word (done or blocked) in place of <done|blocked>; it expands your own $HERDR_PANE_ID, and must carry no secrets or output beyond the outcome word:`,
    "",
    broadcastCommand(name, callerPane),
  ].join("\n");
}

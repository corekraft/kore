export interface BriefInput {
  task: string;
  name: string;
  /** The caller's pane id, read fresh from its own environment. */
  callerPane: string;
}

/** The exact completion command, filled in: the session runs it from its own pane, which reads its name and pane from its environment. */
export function notifyCommand(callerPane: string): string {
  return `node skills/bin/harness.mjs session notify ${callerPane} --outcome <done|blocked>`;
}

/** The review follow-up rules every brief carries, with the broadcast filled in with the caller's pane. */
export function reviewFollowUp(callerPane: string): string {
  return [
    "Review follow-up:",
    "- After each fix push, wait for CI to pass before the next change.",
    "- Never merge; only the judge merges.",
    `- Broadcast each new head SHA with \`node skills/bin/harness.mjs session notify ${callerPane} --outcome done\`; the notify line carries only the outcome, so put the SHA in your printed summary.`,
    "- While a live proof is pinned to a head, change no code, because a change invalidates that proof.",
  ].join("\n");
}

/** The task plus the four things every brief carries: caller pane, session name, review follow-up, broadcast. */
export function buildBrief({ task, name, callerPane }: BriefInput): string {
  return [
    task,
    "",
    `You are ${name}; your session name is ${name}.`,
    "",
    reviewFollowUp(callerPane),
    "",
    `When you finish, broadcast to pane \`${callerPane}\`. Print your summary and a final line with the word RESULT, a colon, then done or blocked. Then, as your very last action, run this one line with the outcome word (done or blocked) in place of <done|blocked>; the command fills in your own name and pane, and must carry no secrets or output beyond the outcome word:`,
    "",
    notifyCommand(callerPane),
  ].join("\n");
}

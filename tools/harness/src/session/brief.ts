export interface BriefInput {
  task: string;
  name: string;
  /** The caller's pane id, read fresh from its own environment. */
  callerPane: string;
  /** The session's role; only the roles that push code get the review follow-up section. */
  role?: string;
}

/** The roles that push code, so they follow the review rules; read-only roles never do. */
const PUSHING_ROLES: ReadonlySet<string> = new Set(["writer", "fixer"]);

/** The exact completion command, filled in: the session runs it from its own pane, which reads its name and pane from its environment. */
export function notifyCommand(callerPane: string): string {
  return `node skills/bin/harness.mjs session notify ${callerPane} --outcome <done|blocked>`;
}

/** The local-check rule for a pushing session; the full suites gate in CI, pointing at AGENTS.md (Changes). */
const LOCAL_CHECKS = [
  "Local checks:",
  "- Locally run only the related tests and typecheck; the full suites run in CI `check` (AGENTS.md, Changes).",
].join("\n");

/** The review follow-up rules for a pushing session. The broadcast is the finish command at the end of the brief, not a second one. */
const REVIEW_FOLLOW_UP = [
  "Review follow-up:",
  "- After each fix push, print the new head SHA in your summary and wait for CI to pass before the next change.",
  "- Never merge; only the judge merges.",
  "- Broadcast only once, when you finish, with harness session notify (the command at the end of this brief).",
  "- While a live proof is pinned to a head, change no code, because a change invalidates that proof.",
].join("\n");

/** The task, the session name, the review follow-up for pushing roles, and the finish instructions. */
export function buildBrief({
  task,
  name,
  callerPane,
  role,
}: BriefInput): string {
  const followUp =
    role !== undefined && PUSHING_ROLES.has(role)
      ? [LOCAL_CHECKS, "", REVIEW_FOLLOW_UP, ""]
      : [];
  return [
    task,
    "",
    `You are ${name}; your session name is ${name}.`,
    "",
    ...followUp,
    `When you finish, broadcast to pane \`${callerPane}\`. Print your summary and a final line with the word RESULT, a colon, then done or blocked. Then, as your very last action, run this one line with the outcome word (done or blocked) in place of <done|blocked>; the command fills in your own name and pane, and must carry no secrets or output beyond the outcome word:`,
    "",
    notifyCommand(callerPane),
  ].join("\n");
}

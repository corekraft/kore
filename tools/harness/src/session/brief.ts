import { extractPaths, skillsForPaths } from "./skill-lookup.js";

export interface BriefInput {
  task: string;
  name: string;
  /** The caller's pane id, read fresh from its own environment. */
  callerPane: string;
  /** The session's role; only the roles that push code get the live-proof section. */
  role?: string;
}

/** The roles that push code, so they follow the review rules; read-only roles never do. */
const PUSHING_ROLES: ReadonlySet<string> = new Set(["writer", "fixer"]);

/** The exact completion command, filled in: the session runs it from its own pane, which reads its name and pane from its environment. */
export function notifyCommand(callerPane: string): string {
  return `node skills/bin/harness.mjs session notify ${callerPane} --outcome <done|blocked>`;
}

/**
 * The live-proof rule for a pushing session. It is the one standing rule the brief keeps: it turns on
 * a proof pinned to a head, which only this session's brief can name. Every other standing rule has
 * its one owner in the role's definition (writer.md).
 */
const LIVE_PROOF = [
  "Live proof:",
  "- While a live proof is pinned to a head, change no code, because a change invalidates that proof.",
].join("\n");

/** The skills section: the skills the task's paths call for, or a statement that none was named. */
function skillSection(task: string): string {
  const skills = skillsForPaths(extractPaths(task));
  if (skills.length === 0) {
    return [
      "Skills:",
      "- No skill was named, because the brief names no path that one covers.",
    ].join("\n");
  }
  const named = skills.map((skill) => `\`${skill}\``);
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return [
    "Skills for the paths you change:",
    `- Load ${list} with the Skill tool before you edit.`,
  ].join("\n");
}

/** The task, the session name, the skills and live-proof sections for pushing roles, and the finish instructions. */
export function buildBrief({
  task,
  name,
  callerPane,
  role,
}: BriefInput): string {
  const followUp =
    role !== undefined && PUSHING_ROLES.has(role)
      ? [skillSection(task), "", LIVE_PROOF, ""]
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

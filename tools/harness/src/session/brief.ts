import { extractPaths, skillsForPaths } from "./skill-lookup.js";

interface BriefBase {
  task: string;
  name: string;
  /** The session's role; only the roles that push code get the live-proof section. */
  role?: string;
}

/**
 * The brief's backend decides how the session finishes: a herdr pane prints its RESULT line and runs the notify
 * command, which names the caller's pane; an hc session runs session report, and a paired one messages its partner
 * by name. The herdr form is unchanged until the hc-sessions flag is retired (plan 16, Step 6).
 */
export type BriefInput = BriefBase &
  (
    | { backend?: "herdr"; callerPane: string }
    | { backend: "hc"; group?: string }
  );

/** The roles that push code, so they follow the review rules; read-only roles never do. */
const PUSHING_ROLES: ReadonlySet<string> = new Set(["writer", "fixer"]);

/** The exact completion command, filled in: the session runs it from its own pane, which reads its name and pane from its environment. */
export function notifyCommand(callerPane: string): string {
  return `node skills/bin/harness.mjs session notify ${callerPane} --outcome <done|blocked>`;
}

/** The finish of a writer, which may write a file: its summary as an argument, or a file under .kore/report for a long one. */
const HC_FINISH_WRITER = [
  "When you finish, print your summary, then as your very last action run `harness session report --outcome <done|blocked> --summary <your summary>`, quoting the summary as one argument. For a long summary, write it under .kore/report and pass `--file <path>` in place of `--summary`. Use blocked only when you cannot go on without a person. Each report takes the next seq, so a rework reports again.",
].join("\n");

/** The finish of a read-only role, which writes no file: its summary goes to session report on stdin, as a heredoc. */
const HC_FINISH_READ =
  "When you finish, print your summary, then as your very last action run `node skills/bin/harness.mjs session report --outcome <done|blocked> --summary - <<'EOF'`, with your summary on the lines after it, then a line that reads EOF. Use blocked only when you cannot go on without a person. Each report takes the next seq, so a rework reports again.";

/** A task that already names its own session report is finished by it, so no second finish is added. */
const namesOwnFinish = (task: string): boolean =>
  /harness\.mjs session report\b|harness session report\b/.test(task);

/** The line a paired session gets: its partner is reached by name, never by an address. */
function groupLine(group: string): string {
  return `Your group is ${group}: a partner session shares it. To message a session you are paired with, run \`harness session send <peer name>\`, where <peer name> is that session's name, given in your task.`;
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
export function buildBrief(input: BriefInput): string {
  const { task, name, role } = input;
  const followUp =
    role !== undefined && PUSHING_ROLES.has(role)
      ? [skillSection(task), "", LIVE_PROOF, ""]
      : [];
  if (input.backend === "hc") {
    const group = input.group === undefined ? [] : [groupLine(input.group), ""];
    const finish = namesOwnFinish(task)
      ? []
      : [
          role !== undefined && PUSHING_ROLES.has(role)
            ? HC_FINISH_WRITER
            : HC_FINISH_READ,
        ];
    return [
      task,
      "",
      `You are ${name}; your session name is ${name}.`,
      "",
      ...followUp,
      ...group,
      ...finish,
    ]
      .join("\n")
      .trimEnd();
  }
  const { callerPane } = input;
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

// Shared by the role guards: which commands change files, and the read-only
// finding. Owner approval to enforce the plan 11 role guards is recorded on
// #190 and #191 (2026-11-12).
import { commandOf } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

export const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/** Commands whose job is to change files, the index, history or a pull request. */
const WRITERS = new Set([
  "tee",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "ln",
  "truncate",
  "dd",
  "install",
]);
const WRITING_GIT = new Set([
  "add",
  "commit",
  "push",
  "apply",
  "am",
  "checkout",
  "switch",
  "restore",
  "reset",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "stash",
  "clean",
  "rm",
  "mv",
  "worktree",
  "tag",
  "branch",
]);
const WRITING_GH = new Set(["merge", "close", "edit", "checkout"]);

export const readOnly = (what: string): Finding =>
  block(
    "role-read-only",
    `${what} changes files, and the concierge, reader, orchestrator and judge never write. ` +
      "Instead, report what needs changing: the concierge files it as an idea, the reader returns it in its summary, " +
      "the orchestrator hands it to a writer and the judge sends the change back.",
  );

const FD_OPERATOR = /^(?:\d*>>?|&>>?)$/;
const harmless = (target: string | undefined): boolean =>
  target === "/dev/null" || target === "&1" || target === "&2";

/** Whether a word redirects output somewhere other than /dev/null or another stream, joined to its target or followed by it. */
const redirectsToFile = (segment: readonly string[]): boolean =>
  segment.some((word, index) => {
    if (FD_OPERATOR.test(word)) {
      return !harmless(segment[index + 1]);
    }
    const joined = /^(?:\d*>>?|&>>?)(.+)$/.exec(word);
    return joined !== null && !harmless(joined[1]);
  });

/** Whether a command writes: a writer, `sed -i`, writing git or gh verbs, or a redirect to a file. */
export function writes(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  const verb = args.find((arg) => !arg.startsWith("-"));
  return (
    redirectsToFile(segment) ||
    WRITERS.has(name) ||
    (name === "sed" && args.some((arg) => /^-\w*i/.test(arg))) ||
    (name === "git" && verb !== undefined && WRITING_GIT.has(verb)) ||
    (name === "gh" &&
      args[0] === "pr" &&
      args[1] !== undefined &&
      WRITING_GH.has(args[1]))
  );
}

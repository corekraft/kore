// What every role-bound pane may not touch, however it asks (#335, ADR 0091): the host's
// credentials, and for a writer the guard it runs under and the commands that decide what
// ships. These are quick fixes for holes the adversarial retro reproduced, not a boundary:
// a writer has a full shell, and the control that stops it is the ruleset and the
// containment around the pane, so each rule here is a named regex over words, nothing more.
import { posix, isAbsolute, relative, resolve } from "node:path";
import { runsInline } from "./guard-role-delivery.js";
import { expand, withSubstitutions } from "./guard-role-merge.js";
import {
  redirectTargets,
  withoutRedirects,
  writes,
  WRITE_TOOLS,
} from "./guard-role-writes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

/** `~/.ssh`, `~/.kube/config` and `~/.config/gh`: key, cluster and GitHub token material that no pane has a task for. */
const HOST_SECRET =
  /(?:^|[/\s='"~:])\.ssh(?:\/|$|[\s'"])|\.kube\/config|\.config\/gh(?:\/|$|[\s'"])/;
/** The tool inputs that name a path or a command. */
const NAMING_FIELDS = [
  "command",
  "file_path",
  "notebook_path",
  "path",
  "pattern",
  "glob",
];

/** The text a tool call names, and for a command also its unquoted words, so `~/.s''sh` reads as `~/.ssh`. */
function named(input: Record<string, unknown>): string[] {
  return NAMING_FIELDS.flatMap((field) => {
    const value = input[field];
    if (typeof value !== "string") {
      return [];
    }
    return field === "command"
      ? [value, ...splitSegments(value).map((segment) => segment.join(" "))]
      : [value];
  });
}

const hostSecret = (): Finding =>
  block(
    "secret-path",
    "~/.ssh, ~/.kube/config and ~/.config/gh hold keys and tokens, and no role-bound pane may read or write them. " +
      "Instead, use `gh` and `kubectl` as they are configured, or ask the user to handle the credential.",
  );

const protectedBlock = (what: string): Finding =>
  block(
    "role-protected",
    `${what} is the guard bundle, a hook, or a command that flips a flag, records an outcome or dispatches a workflow; a writer may not change or run it. ` +
      "Instead, report that the change needs the person or the orchestrator, and describe what to do.",
  );

/** The guard's own files: the bundle and everything under `.claude/hooks`. */
const GUARD_FILE = /skills\/bin\/harness\.mjs|\.claude\/hooks(?:\/|$|['"\s)])/;

/** Whether a word names a guard file, as written or with `.` and `..` segments resolved. */
const namesGuardFile = (word: string): boolean =>
  GUARD_FILE.test(word) || GUARD_FILE.test(posix.normalize(word));

/** Whether a file tool targets a guard file, with `..` resolved against the worktree. */
function editsGuardFile(root: string, path: string): boolean {
  const from = relative(root, resolve(root, path));
  return !from.startsWith("..") && !isAbsolute(from) && namesGuardFile(from);
}

/** The command lines a Bash call may run: its segments, those inside substitutions, and those inside env, `bash -c`, xargs and eval. */
const linesOf = (command: string): string[][] =>
  withSubstitutions(command).flatMap((segment) => expand(segment));

/** A line that writes to a guard file: a redirect to it, or a writing command or inline script that names it. */
function writesGuardFile(line: readonly string[]): boolean {
  const rest = withoutRedirects(line);
  const words = writes(rest) || runsInline(rest) ? rest : [];
  return [...redirectTargets(line), ...words].some(namesGuardFile);
}

const WITHOUT_VALUE = new Set(["-R", "--repo"]);

/** `gh workflow run`, with `-R <repo>` allowed anywhere before the verb. */
function dispatchesWorkflow(args: readonly string[]): boolean {
  const plain = args.filter(
    (arg, i) =>
      !WITHOUT_VALUE.has(arg) &&
      !WITHOUT_VALUE.has(args[i - 1] ?? "") &&
      !arg.startsWith("--repo="),
  );
  return plain[0] === "workflow" && plain[1] === "run";
}

const GATED_HARNESS = ["flag activate", "outcome record"];

/** The words after the harness, run as the bundle, its launcher or the bare name; undefined when the line is not the harness. */
function harnessWords(line: readonly string[]): readonly string[] | undefined {
  const { name, args } = commandOf(line);
  if (name === "node") {
    return (args[0] ?? "").endsWith("harness.mjs") ? args.slice(1) : undefined;
  }
  return /^harness(?:\.mjs|\.sh)?$/.test(name) ? args : undefined;
}

/** A line that activates a flag, records an outcome or dispatches a workflow. */
function runsGated(line: readonly string[]): boolean {
  const { name, args } = commandOf(line);
  const harness = harnessWords(line);
  return (
    (name === "gh" && dispatchesWorkflow(args)) ||
    (harness !== undefined &&
      GATED_HARNESS.includes(`${harness[0] ?? ""} ${harness[1] ?? ""}`))
  );
}

/** The refusal for one role-bound call; null when it names nothing protected. */
export function checkProtected(
  role: string,
  tool: string,
  input: Record<string, unknown>,
  root: string,
): Finding {
  if (named(input).some((text) => HOST_SECRET.test(text))) {
    return hostSecret();
  }
  if (role !== "writer") {
    return null;
  }
  const path = input["file_path"] ?? input["notebook_path"];
  if (WRITE_TOOLS.has(tool)) {
    return typeof path === "string" && editsGuardFile(root, path)
      ? protectedBlock(`${tool} ${path}`)
      : null;
  }
  const command = input["command"];
  if (tool !== "Bash" || typeof command !== "string") {
    return null;
  }
  const line = linesOf(command).find(
    (candidate) => writesGuardFile(candidate) || runsGated(candidate),
  );
  return line === undefined ? null : protectedBlock(`\`${line.join(" ")}\``);
}

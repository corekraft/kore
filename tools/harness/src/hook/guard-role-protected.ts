// What every role-bound pane may not touch, however it asks (#335, ADR 0091): the host's
// credentials, and for a writer the guard it runs under and the commands that decide what
// ships. These are hints, not a boundary: containment comes from #336 and #337, so each
// check is a cheap match over path-like words and the file tools' path fields.
//
// Known limits, accepted under ADR 0091 and not chased: a path or command built through a
// variable or a `cd`, and a writer editing tools/harness/src/hook and rebuilding the bundle.
import { posix, isAbsolute, relative } from "node:path";
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

/** Whether `pattern` (`*` any run, `?` and `[...]` one character) matches `text`; a leading dot needs a literal dot, as in a shell. */
function globMatches(pattern: string, text: string): boolean {
  if (text.startsWith(".") && !pattern.startsWith(".")) {
    return false;
  }
  const units = pattern.replace(/\[[^\]]*\]/g, "?");
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (units[p] === "*") {
      star = p++;
      resume = t;
    } else if (units[p] === "?" || units[p] === text[t]) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++resume;
    } else {
      return false;
    }
  }
  return units.slice(p).replace(/\*/g, "") === "";
}

/** How many characters of a glob are literal, so `.*` is too thin a match to name a protected path. */
const literals = (part: string): number => part.replace(/[*?[\]]/g, "").length;
const MIN_LITERALS = 3;

/** Whether the path's leading components name `target`, with globs in the path read as the shell would expand them. */
function namesPath(
  parts: readonly string[],
  target: readonly string[],
  exact = false,
): boolean {
  return (
    (exact ? parts.length === target.length : parts.length >= target.length) &&
    target.every((name, i) => globMatches(parts[i] as string, name)) &&
    parts
      .slice(0, target.length)
      .reduce((sum, part) => sum + literals(part), 0) >= MIN_LITERALS
  );
}

/** The components of a path with `//`, `.` and `..` collapsed and a leading `./` or `~/` dropped. */
const componentsOf = (word: string): string[] =>
  posix
    .normalize(word.replace(/^~(?=\/)/, "~home"))
    .split("/")
    .filter((part) => part !== "" && part !== ".");

/** The words a path could be written as: the word, the value of `--opt=value`, and without a redirect operator. */
function pathForms(word: string): string[] {
  const bare = word.replace(/^\d*[<>][>|]?|^&>>?/, "");
  const value = bare.startsWith("-") ? bare.slice(bare.indexOf("=") + 1) : bare;
  return [bare, value];
}

/** `~/.ssh`, `~/.kube/config` and `~/.config/gh`: key, cluster and GitHub token material that no pane has a task for. */
const HOST_SECRETS = [[".ssh"], [".kube", "config"], [".config", "gh"]];

/** A home folder as a search root: it holds `.ssh`, `.kube` and `.config`. */
const HOME_DIR = /^(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/]+|\/home\/[^/]+)\/*$/;
/** Folders that hold credential material without being it. */
const SECRET_PARENTS = [".kube", ".config"];

/** Whether searching from this path reaches credential material: it names one, or it is the folder that holds one. */
function searchesHostSecret(path: string): boolean {
  const last = componentsOf(path).at(-1) ?? "";
  return (
    namesHostSecret(path) ||
    HOME_DIR.test(path) ||
    SECRET_PARENTS.some(
      (parent) => globMatches(last, parent) && literals(last) >= MIN_LITERALS,
    )
  );
}

/** Whether a path, wherever it starts, passes through host credential material. */
function namesHostSecret(path: string): boolean {
  const parts = componentsOf(path);
  return parts.some((_, from) =>
    HOST_SECRETS.some((secret) => namesPath(parts.slice(from), secret)),
  );
}

/** The fields that hold a path; a Glob's pattern is one too, but a Grep's pattern is text to search for. */
const PATH_FIELDS = ["file_path", "notebook_path", "path"];

const SEARCHERS = new Set(["grep", "egrep", "fgrep", "rg", "ag"]);
/** Commands that read every file under the folders they are given. */
const WALKERS = new Set([...SEARCHERS, "find"]);

/** The words of a segment that can be paths: for a search command, not the pattern it looks for (its first operand, or the value of -e). */
function operands(segment: readonly string[]): string[] {
  const { name, args } = commandOf(segment);
  if (!SEARCHERS.has(name)) {
    return [...segment];
  }
  const patterned = args.some((arg) => /^-[a-zA-Z]*e$|^--regexp/.test(arg));
  let skipped = patterned;
  return args.filter((arg, i) => {
    const pattern = /^-[a-zA-Z]*e$|^--regexp$/.test(args[i - 1] ?? "");
    if (!skipped && !arg.startsWith("-")) {
      skipped = true;
      return false;
    }
    return !pattern;
  });
}

/** The folders a Grep, Glob or searching command starts from. */
function searchRoots(tool: string, input: Record<string, unknown>): string[] {
  const command = input["command"];
  if (tool === "Bash" && typeof command === "string") {
    return splitSegments(command).flatMap((segment) =>
      WALKERS.has(commandOf(segment).name) ? operands(segment) : [],
    );
  }
  const path = input["path"];
  return (tool === "Grep" || tool === "Glob") && typeof path === "string"
    ? [path]
    : [];
}

/** The paths a call names: a file tool's path fields, and a command's words with no whitespace (a commit message or `--body` text has some). */
function pathsNamed(tool: string, input: Record<string, unknown>): string[] {
  const fields = tool === "Glob" ? [...PATH_FIELDS, "pattern"] : PATH_FIELDS;
  const fromFields = fields.flatMap((field) => {
    const value = input[field];
    return typeof value === "string" ? [value] : [];
  });
  const command = input["command"];
  const words =
    tool === "Bash" && typeof command === "string"
      ? splitSegments(command)
          .flatMap(operands)
          .filter((word) => !/\s/.test(word))
      : [];
  return [...fromFields, ...words].flatMap(pathForms);
}

const hostSecret = (): Finding =>
  block(
    "secret-path",
    "~/.ssh, ~/.kube/config and ~/.config/gh hold keys and tokens, and no role-bound pane may read or write them. " +
      "Instead, use `gh` and `kubectl` as they are configured, or ask the user to handle the credential.",
  );

/** The writer's own guard: the bundle's folder, the hooks, the settings and the `.claude` folder itself. */
const GUARD_PATHS: readonly (readonly [readonly string[], boolean])[] = [
  [["skills", "bin"], false],
  [[".claude", "hooks"], false],
  [[".claude", "settings.json"], false],
  // The folder itself, so `rm -rf .claude`; its agents, evals and skills are ordinary work.
  [[".claude"], true],
];
/** The guard's files as inline code or a script names them, where a word is a whole program. */
const GUARD_TEXT =
  /skills\/bin\b|\.claude\/(?:hooks|settings\.json)|(?:^|[\s'"])\.claude(?:['"\s)]|$)/;

const guardFile = (what: string): Finding =>
  block(
    "role-read-only",
    `${what} changes the guard bundle, a hook or the settings, and a writer may not edit the guard it runs under. ` +
      "Instead, report that the change needs the person, and describe what to change.",
  );

const gated = (what: string): Finding =>
  block(
    "role-no-merge",
    `${what} activates a flag, records an outcome or dispatches a workflow, which is the person's or the orchestrator's call, not a writer's. ` +
      "Instead, report that it is ready, and the orchestrator or the person runs it.",
  );

/** Whether a word names a guard path, relative to the worktree or inside it by absolute path. */
function namesGuardPath(root: string, word: string): boolean {
  const inside = isAbsolute(word) ? relative(root, word) : word;
  return (
    GUARD_TEXT.test(word) ||
    (!inside.startsWith("..") &&
      GUARD_PATHS.some(([target, exact]) =>
        namesPath(componentsOf(inside), target, exact),
      ))
  );
}

/** The command lines a Bash call may run: its segments, those inside substitutions, and those inside env, `bash -c`, xargs and eval. */
const linesOf = (command: string): string[][] =>
  withSubstitutions(command).flatMap((segment) => expand(segment));

/** A line that writes to a guard path: a redirect to it, or a writing command or inline script that names it. */
function writesGuardPath(root: string, line: readonly string[]): boolean {
  const rest = withoutRedirects(line);
  // A word with whitespace is text (a commit message), not a path, unless it is inline code.
  const inline = runsInline(rest);
  const words =
    writes(rest) || inline
      ? rest.filter((word) => inline || !/\s/.test(word))
      : [];
  return [...redirectTargets(line), ...words]
    .flatMap(pathForms)
    .some((word) => namesGuardPath(root, word));
}

const WITHOUT_VALUE = new Set(["-R", "--repo"]);

/** `gh workflow run`, or an API call to a dispatches route, with `-R <repo>` allowed anywhere before the verb. */
function dispatchesWorkflow(args: readonly string[]): boolean {
  const plain = args.filter(
    (arg, i) =>
      !WITHOUT_VALUE.has(arg) &&
      !WITHOUT_VALUE.has(args[i - 1] ?? "") &&
      !arg.startsWith("--repo=") &&
      !/^-R./.test(arg),
  );
  return (
    (plain[0] === "workflow" && plain[1] === "run") ||
    (plain[0] === "api" && plain.some((arg) => /\/dispatches\b/.test(arg)))
  );
}

const GATED_HARNESS = ["flag activate", "outcome record"];
const INTERPRETERS = new Set(["node", "bash", "sh", "zsh", "dash", "ksh"]);
const HARNESS_SCRIPT = /(?:^|\/)harness\.(?:mjs|sh)$/;

/** The words after the harness, run as the bundle or the launcher (through an interpreter and its flags) or by name; undefined when the line is not the harness. */
function harnessWords(line: readonly string[]): readonly string[] | undefined {
  const { name, args } = commandOf(line);
  if (INTERPRETERS.has(name)) {
    const at = args.findIndex((arg) => HARNESS_SCRIPT.test(arg));
    return at < 0 ? undefined : args.slice(at + 1);
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
  if (
    pathsNamed(tool, input).some(namesHostSecret) ||
    searchRoots(tool, input).flatMap(pathForms).some(searchesHostSecret)
  ) {
    return hostSecret();
  }
  if (role !== "writer") {
    return null;
  }
  const path = input["file_path"] ?? input["notebook_path"];
  if (WRITE_TOOLS.has(tool)) {
    return typeof path === "string" && namesGuardPath(root, path)
      ? guardFile(`${tool} ${path}`)
      : null;
  }
  const command = input["command"];
  if (tool !== "Bash" || typeof command !== "string") {
    return null;
  }
  const lines = linesOf(command);
  const file = lines.find((line) => writesGuardPath(root, line));
  if (file !== undefined) {
    return guardFile(`\`${file.join(" ")}\``);
  }
  const gate = lines.find(runsGated);
  return gate === undefined ? null : gated(`\`${gate.join(" ")}\``);
}

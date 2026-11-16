// The seven reads a read-only role may run besides its read utilities (#847): git merge-base, cat-file,
// ls-tree and ls-remote, which, command -v and harness --help. Each is allowed by its exact argv shape.
// `git fetch` is not among them. The subcommand comes first, only the options listed here are accepted,
// and every other option (--upload-pack, --exec, -c, -o, --output, --textconv, --filters) is refused,
// because a word that is not in the shape is not a read.

/** A revision, object or path word: it names something and starts no option. */
const NAME = /^[\w@{}^~:./+=,%-]+$/;
const isName = (word: string): boolean =>
  NAME.test(word) && !word.startsWith("-");

/** `git merge-base [--all] A B...` or `--is-ancestor A B`: one option at most, then at least two revisions. */
function mergeBaseMayRun(args: readonly string[]): boolean {
  const option = args[0]?.startsWith("-") === true ? args[0] : undefined;
  const revs = option === undefined ? args : args.slice(1);
  return (
    (option === undefined ||
      option === "--all" ||
      option === "--is-ancestor") &&
    revs.length >= 2 &&
    (option !== "--is-ancestor" || revs.length === 2) &&
    revs.every(isName)
  );
}

/** `git cat-file -t|-s|-e|-p OBJECT`; --textconv and --filters run a driver, --batch reads commands. */
const catFileMayRun = ([mode, object, ...rest]: readonly string[]): boolean =>
  ["-t", "-s", "-e", "-p"].includes(mode ?? "") &&
  object !== undefined &&
  isName(object) &&
  rest.length === 0;

const LS_TREE_OPTIONS = new Set([
  "-r",
  "-d",
  "-t",
  "-l",
  "-z",
  "--long",
  "--name-only",
  "--name-status",
  "--full-name",
  "--full-tree",
]);

/** `git ls-tree [listed options] TREE-ISH [-- PATH...]`; the options come first and a path may not start one. */
function lsTreeMayRun(args: readonly string[]): boolean {
  const options = args.findIndex((arg) => !arg.startsWith("-"));
  const [tree, ...paths] = options === -1 ? [] : args.slice(options);
  const separator = paths[0] === "--" ? 1 : 0;
  return (
    options !== -1 &&
    args.slice(0, options).every((arg) => LS_TREE_OPTIONS.has(arg)) &&
    tree !== undefined &&
    isName(tree) &&
    paths
      .slice(separator)
      .every((path) => path !== "--" && (separator === 1 || isName(path)))
  );
}

const LS_REMOTE_OPTIONS = new Set([
  "--heads",
  "--tags",
  "--refs",
  "-q",
  "--quiet",
  "--symref",
]);
/** A configured remote's name or an http(s) URL: no `ext::` transport, local path or `-o` host trick. */
const REMOTE = /^(?:[A-Za-z0-9][\w.-]*|https?:\/\/[A-Za-z0-9][\w.@:/-]*)$/;

/** `git ls-remote [listed options] REMOTE [PATTERN...]`: --upload-pack, --exec, -c and -o are not listed. */
function lsRemoteMayRun(args: readonly string[]): boolean {
  const options = args.findIndex((arg) => !arg.startsWith("-"));
  const [remote, ...patterns] = options === -1 ? [] : args.slice(options);
  return (
    options !== -1 &&
    args.slice(0, options).every((arg) => LS_REMOTE_OPTIONS.has(arg)) &&
    remote !== undefined &&
    REMOTE.test(remote) &&
    patterns.every(isName)
  );
}

/** The four git reads of the seven, by subcommand and exact shape; the caller refuses a repository or config option before the subcommand. */
export function gitReadMayRun(args: readonly string[]): boolean {
  const [verb, ...rest] = args;
  switch (verb) {
    case "merge-base":
      return mergeBaseMayRun(rest);
    case "cat-file":
      return catFileMayRun(rest);
    case "ls-tree":
      return lsTreeMayRun(rest);
    case "ls-remote":
      return lsRemoteMayRun(rest);
    default:
      return false;
  }
}

/** A program name for `which` and `command -v`: no option, path or shell word. */
const PROGRAM = /^\w[\w.+@-]*$/;

/** `which [-a] NAME...` looks a program up and runs nothing. */
export const whichMayRun = (args: readonly string[]): boolean => {
  const names = args[0] === "-a" ? args.slice(1) : args;
  return names.length > 0 && names.every((word) => PROGRAM.test(word));
};

/** `command -v NAME...` looks a program up and runs nothing; `command` is also a wrapper, so every other form after it stays a prefix. */
export const commandLookup = (segment: readonly string[]): boolean =>
  segment[0] === "command" &&
  segment[1] === "-v" &&
  segment.length > 2 &&
  segment.slice(2).every((word) => PROGRAM.test(word));

// Routes to main, or past the `main` ruleset, other than a merge command or a push (those are
// in guard-role-merge.ts and guard-role-push.ts). The same limit applies: a writer has a full
// shell, so this is defence in depth, and the ruleset without owner bypass is the control.
import { expand, isDash } from "./guard-role-merge.js";
import { gitCall, PUSH_KEY } from "./guard-role-push.js";
import { commandOf } from "./guard-shell.js";

const FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);
const GH_MUTATES =
  /\/git\/(refs|commits|trees|tags)\b|\/contents\/|\/rulesets\b|\/branches\/[^/]+\/(protection|rename)\b/;

/** Whether a `gh api` call writes: an explicit method other than GET, or a field (which makes it a POST). */
function apiWrites(args: readonly string[]): boolean {
  const at = args.findIndex((a) => a === "-X" || a === "--method");
  const inline = args.find((a) => /^(-X|--method=)./.test(a));
  const method = (
    at >= 0 ? args[at + 1] : inline?.replace(/^(-X|--method=)/, "")
  )?.toUpperCase();
  if (method !== undefined) {
    return method !== "GET";
  }
  return args.some(
    (a) => FIELD_FLAGS.has(a) || /^--(field|raw-field)=/.test(a),
  );
}

/** `gh` forms that move a branch, rewrite the ruleset or install an alias that runs a merge. */
function ghRoute(line: readonly string[]): boolean {
  const { name, args } = commandOf(line);
  if (name !== "gh") {
    return false;
  }
  return (
    (args[0] === "alias" && /^(set|import)$/.test(args[1] ?? "")) ||
    (args[0] === "api" &&
      apiWrites(args) &&
      args.some((a) => GH_MUTATES.test(a)))
  );
}

/** Whether a segment, through its wrappers, takes a route to main that every role-bound pane is refused. */
export const takesRoute = (segment: readonly string[]): boolean =>
  expand(segment).some(ghRoute);

const READ_FLAGS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--list",
  "-l",
  "--get-urlmatch",
]);
const WRITE_FLAGS = new Set([
  "--add",
  "--unset",
  "--unset-all",
  "--replace-all",
  "--rename-section",
  "--remove-section",
  "--edit",
  "-e",
]);

/** `git config` that writes a remote.*, push.* or branch.* key, which redirects a later push. */
function configWrite(line: readonly string[]): boolean {
  const call = gitCall(line);
  if (call?.sub !== "config" || call.args.some((a) => READ_FLAGS.has(a))) {
    return false;
  }
  const words = call.args.filter((a) => !isDash(a));
  const key = words.find((w) => PUSH_KEY.test(w));
  const keyAt = key === undefined ? -1 : words.indexOf(key);
  return (
    key !== undefined &&
    (words.length > keyAt + 1 || call.args.some((a) => WRITE_FLAGS.has(a)))
  );
}

/** `gh auth token` and `gh auth status --show-token`, which print the credential a script could use against the API. */
function authToken(line: readonly string[]): boolean {
  const { name, args } = commandOf(line);
  return (
    name === "gh" &&
    args[0] === "auth" &&
    (args[1] === "token" ||
      (args[1] === "status" &&
        args.some((a) => a === "-t" || a === "--show-token")))
  );
}

/** `gh api graphql` whose query holds a shell expansion, so the guard never sees the query that runs. */
function graphqlExpands(line: readonly string[]): boolean {
  const { name, args } = commandOf(line);
  return (
    name === "gh" &&
    args[0] === "api" &&
    args[1] === "graphql" &&
    args.some((a) => a.includes("$"))
  );
}

/** Whether a segment takes a route only the writer can reach, since it alone has the full shell. */
export const takesWriterRoute = (segment: readonly string[]): boolean =>
  expand(segment).some(
    (line) => configWrite(line) || authToken(line) || graphqlExpands(line),
  );

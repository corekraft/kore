#!/usr/bin/env node
// PreToolUse guard: enforces mechanically checkable rules from AGENTS.md.
// Plan: infra/plans/3-agent-harness.md (Step 2). Node standard library only.
//
// Contract: reads the tool call as JSON on stdin. Exit 2 with the reason on
// stderr blocks the call. A warning is returned as additionalContext. Malformed
// input fails open, because a broken guard must not stop all work.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const OPERATORS = new Set([";", "&&", "||", "|", "&", "\n"]);

/** Split a shell command into segments of unquoted-word tokens. */
export function splitSegments(command) {
  const segments = [];
  let tokens = [];
  let word = "";
  let inWord = false;
  let quote = null;

  const endWord = () => {
    if (inWord) tokens.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && i + 1 < command.length)
        word += command[++i];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (char === " " || char === "\t") {
      endWord();
    } else if (char === "\n" || char === ";") {
      endSegment();
    } else if ((char === "&" || char === "|") && command[i + 1] === char) {
      endSegment();
      i++;
    } else if (
      char === "|" ||
      (char === "&" && command[i + 1] !== ">" && command[i - 1] !== ">")
    ) {
      endSegment();
    } else {
      word += char;
      inWord = true;
    }
  }
  endSegment();
  return segments.filter(
    (segment) => !(segment.length === 1 && OPERATORS.has(segment[0])),
  );
}

const WRAPPERS = new Set(["sudo", "env", "time", "command", "nohup", "exec"]);

/** Return the command name and its arguments, skipping env assignments and wrappers. */
function commandOf(tokens) {
  let index = 0;
  while (
    index < tokens.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) ||
      WRAPPERS.has(tokens[index]))
  ) {
    index++;
  }
  if (index >= tokens.length) return { name: "", args: [] };
  return { name: basename(tokens[index]), args: tokens.slice(index + 1) };
}

const isKore = (name, args) =>
  name === "kore" ||
  (name === "npm" && args.includes("kore")) ||
  (name === "node" && args.some((arg) => arg.endsWith("cli/cli.js")));

const hasFlag = (args, flag) =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
const firstPositional = (args) => args.find((arg) => !arg.startsWith("-"));

const block = (rule, message) => ({
  action: "block",
  rule,
  message: `[guard:${rule}] ${message}`,
});
const warn = (rule, message) => ({
  action: "warn",
  rule,
  message: `[guard:${rule}] ${message}`,
});
const allow = { action: "allow" };

const KUBECTL_OFFLINE = new Set([
  "config",
  "completion",
  "help",
  "kustomize",
  "plugin",
]);
const HELM_CLUSTER = new Set([
  "install",
  "upgrade",
  "uninstall",
  "list",
  "ls",
  "status",
  "rollback",
  "get",
  "test",
  "history",
]);

function checkContext(name, args) {
  if (name === "kubectl") {
    const sub = firstPositional(args);
    const offline =
      !sub ||
      KUBECTL_OFFLINE.has(sub) ||
      (sub === "version" && args.includes("--client"));
    if (!offline && !hasFlag(args, "--context")) {
      return block(
        "kubectl-context",
        "kubectl ran without --context, so it would target whatever context is current. " +
          "Instead, pass --context with the environment's configured context (for example --context kore-local).",
      );
    }
  }
  if (name === "helm") {
    const sub = firstPositional(args);
    if (sub && HELM_CLUSTER.has(sub) && !hasFlag(args, "--kube-context")) {
      return block(
        "helm-context",
        "helm ran without --kube-context, so it would target whatever context is current. " +
          "Instead, pass --kube-context with the environment's configured context.",
      );
    }
  }
  return null;
}

function checkDestructive(name, args) {
  const destructive = () =>
    block(
      "destructive",
      "Destructive operations need a human's explicit consent. " +
        "Instead, ask the user to run the command themselves (for example with `! <command>`), or use a non-destructive alternative.",
    );
  if (name === "minikube" && firstPositional(args) === "delete")
    return destructive();
  if (name === "k3d") {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    const clusterAt = positional.indexOf("cluster");
    if (clusterAt >= 0 && positional.indexOf("delete", clusterAt) >= 0)
      return destructive();
  }
  if ((name === "tofu" || name === "terraform") && args.includes("destroy"))
    return destructive();
  if (name === "helm" && firstPositional(args) === "uninstall")
    return destructive();
  if (name === "kubectl") {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    const deleteAt = positional.indexOf("delete");
    if (
      deleteAt >= 0 &&
      ["namespace", "namespaces", "ns"].includes(positional[deleteAt + 1])
    ) {
      return destructive();
    }
  }
  if (isKore(name, args) && args.includes("destroy")) return destructive();
  return null;
}

function checkNoVerify(name, args) {
  if (name !== "git") return null;
  const commitAt = args.indexOf("commit");
  if (commitAt < 0) return null;
  const rest = args.slice(commitAt + 1);
  const skips = rest.some(
    (arg) => arg === "--no-verify" || /^-[A-Za-z]*n[A-Za-z]*$/.test(arg),
  );
  if (!skips) return null;
  return block(
    "no-verify",
    "Skipping commit hooks bypasses formatting, lint, and commit-message checks. " +
      "Instead, fix what the hook reports and commit again without --no-verify.",
  );
}

const SECRET_PATH = /(^|[/\s>'"=])\.kore\/(keys\/|state\/[^/\s'"]*token)/;
const SECRET_SAFE = new Set(["ls", "stat", "test", "["]);

const secretBlock = () =>
  block(
    "secret-path",
    "Key and token material under .kore/ must not be read or written directly. " +
      "Instead, use a kore command that streams the secret through stdin, or ask the user to handle it.",
  );

function loadSopsPatterns(ctx) {
  let text;
  try {
    text = ctx.readFile(`${ctx.root}/.sops.yaml`);
  } catch {
    return [];
  }
  const patterns = [];
  for (const match of text.matchAll(/path_regex:\s*(.+)$/gm)) {
    try {
      // nosemgrep: kore-dynamic-regexp -- path_regex comes from the committed .sops.yaml, not external input
      patterns.push(new RegExp(match[1].trim().replace(/^['"]|['"]$/g, "")));
    } catch {
      // An unparsable pattern cannot be checked; skip it rather than block work.
    }
  }
  return patterns;
}

const sopsBlock = (path) =>
  block(
    "sops-plaintext",
    `${path} is an encrypted secret path; plaintext must never be written to it. ` +
      "Instead, edit it with `sops <path>` or encrypt through `sops --encrypt`.",
  );

// Append-only records: written only by their owning script, never by hand.
// Audit mode (warn).
const APPEND_ONLY =
  /(^|[/\s>'"=])(\.claude\/evals\/history\.jsonl|\.kore\/state\/journal\/[^/\s'"]*\.jsonl|\.kore\/state\/ledger\.jsonl)$/;
const isAppendOnly = (path) => APPEND_ONLY.test(path);

const appendOnlyWarn = (path) =>
  warn(
    "append-only",
    `${path} is an append-only record: .claude/evals/history.jsonl is owned by eval.mjs, ` +
      `.kore/state/journal/*.jsonl by kore, .kore/state/ledger.jsonl by the harness ledger tool (\`harness ledger record\`). ` +
      `Instead, append through the owning script (eval.mjs, kore, harness ledger); never edit, truncate, move, or remove it by hand.`,
  );

// Outcome records: written by the outcome tool (ticket #187), never typed into an
// idea by hand (ADR 0079). Audit mode (warn) first, per ADR 0080.
const IDEA_PATH = /^docs\/ideas\/[^/]+\.md$/;
const HAND_WRITTEN_OUTCOME = /^(?:#{1,6}[ \t]+outcome\b|outcome:)/im;

const ideaOutcomeWarn = (path) =>
  warn(
    "idea-outcome",
    `${path} is an idea record: its outcome is written by the outcome tool, never by hand. ` +
      "That tool arrives with ticket #187. Instead, leave the outcome out of the file for now and note the result on the idea's issue.",
  );

// Idea issue bodies: rendered from docs/ideas by `harness idea sync` (ADR 0079), the only
// writer. A hand-written body is overwritten by the next sync. The guard cannot tell which
// issues are ideas, so it warns on any issue-body edit. Audit mode (warn) first, per ADR 0080.
const BODY_FLAGS = ["--body", "--body-file", "-b", "-F"];

function checkIdeaIssueBody(name, args) {
  if (name !== "gh" || args[0] !== "issue" || args[1] !== "edit") return null;
  if (!BODY_FLAGS.some((flag) => hasFlag(args, flag))) return null;
  return warn(
    "idea-issue-body",
    "Issue bodies for ideas are rendered from docs/ideas and overwritten by the next sync. " +
      "Instead, edit the idea's markdown and run `harness idea sync --idea <number or slug>`; " +
      "use labels, assignees and comments for anything workflow-related.",
  );
}

const TRUNCATING_REDIRECT = /^(?:\d*|&)>(?!>)(.*)$/;

// Removing or moving these directories removes every journal inside them.
const PROTECTED_DIRS = new Set([".kore", ".kore/state", ".kore/state/journal"]);

function isProtectedDir(arg, root) {
  let path = arg.replace(/^\.\//, "").replace(/\/+$/, "");
  const base = root.replace(/\/+$/, "");
  if (base && path.startsWith(`${base}/`)) path = path.slice(base.length + 1);
  return PROTECTED_DIRS.has(path);
}

function checkAppendOnly(name, args, segment, root) {
  const rewrites = (args) => args.find((arg) => isAppendOnly(arg));
  if (name === "rm" || name === "mv") {
    const dir = args.find(
      (arg) => !arg.startsWith("-") && isProtectedDir(arg, root),
    );
    if (dir) return appendOnlyWarn(dir);
  }
  for (let i = 0; i < segment.length; i++) {
    const match = TRUNCATING_REDIRECT.exec(segment[i]);
    if (!match) continue;
    const target = (match[1].replace(/^\|/, "") || segment[i + 1]) ?? "";
    if (isAppendOnly(target)) return appendOnlyWarn(target);
  }
  const inPlace = (arg) =>
    /^-[A-Za-z]*i/.test(arg) || arg.startsWith("--in-place");
  const destructive =
    ["rm", "mv", "truncate"].includes(name) ||
    (name === "sed" && args.some(inPlace));
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const appends = args.some((arg) => arg === "-a" || arg === "--append");
  const path = destructive
    ? rewrites(args)
    : name === "tee" && !appends
      ? rewrites(operands)
      : name === "cp"
        ? rewrites(operands.slice(-1))
        : undefined;
  return path ? appendOnlyWarn(path) : null;
}

function checkBashSegment(segment, ctx) {
  const { name, args } = commandOf(segment);
  if (!name) return null;
  const text = segment.join(" ");

  if (!SECRET_SAFE.has(name) && !isKore(name, args) && SECRET_PATH.test(text))
    return secretBlock();

  if (name !== "sops") {
    const writes =
      text.includes(">") || ["tee", "cp", "mv", "sed"].includes(name);
    if (writes) {
      const patterns = loadSopsPatterns(ctx);
      const target = segment.find((token) => {
        const path = token.replace(/^>+/, "");
        return patterns.some((pattern) => pattern.test(path));
      });
      if (target) return sopsBlock(target.replace(/^>+/, ""));
    }
  }

  return (
    checkDestructive(name, args) ??
    checkContext(name, args) ??
    checkNoVerify(name, args) ??
    checkIdeaIssueBody(name, args) ??
    checkAppendOnly(name, args, segment, ctx.root)
  );
}

const THRESHOLD =
  /\b(statements|branches|functions|lines)\s*:\s*(\d+(?:\.\d+)?)/g;

function thresholds(text) {
  return new Map(
    [...text.matchAll(THRESHOLD)].map((match) => [match[1], Number(match[2])]),
  );
}

function lowersThresholds(before, after) {
  const previous = thresholds(before);
  for (const [key, value] of thresholds(after)) {
    if (previous.has(key) && value < previous.get(key)) return true;
  }
  return false;
}

const IMAGE_LINE = /^\s*-?\s*image:\s*["']?([^\s"'#]+)/gm;

function checkFile(tool, input, relative, ctx) {
  if (SECRET_PATH.test(relative)) return secretBlock();

  if (tool !== "Read") {
    if (isAppendOnly(relative)) return appendOnlyWarn(relative);

    if (IDEA_PATH.test(relative)) {
      const text =
        tool === "Edit" ? (input.new_string ?? "") : (input.content ?? "");
      if (HAND_WRITTEN_OUTCOME.test(text)) return ideaOutcomeWarn(relative);
    }

    if (loadSopsPatterns(ctx).some((pattern) => pattern.test(relative))) {
      const encrypted = tool === "Write" && /^sops:/m.test(input.content ?? "");
      if (!encrypted) return sopsBlock(relative);
    }

    if (relative === "tools/kore/vitest.config.ts") {
      let before = "";
      let after = "";
      if (tool === "Edit") {
        before = input.old_string ?? "";
        after = input.new_string ?? "";
      } else {
        try {
          before = ctx.readFile(`${ctx.root}/${relative}`);
        } catch {
          before = "";
        }
        after = input.content ?? "";
      }
      if (lowersThresholds(before, after)) {
        return block(
          "coverage-threshold",
          "Coverage thresholds only go up. " +
            "Instead, add tests for the uncovered code and leave the thresholds unchanged.",
        );
      }
    }

    if (
      relative.startsWith("apps/") ||
      relative.startsWith("infra/environments/")
    ) {
      const text =
        tool === "Edit" ? (input.new_string ?? "") : (input.content ?? "");
      const tagged = [...text.matchAll(IMAGE_LINE)].filter(
        (m) => !m[1].includes("@sha256:"),
      );
      if (tagged.length > 0) {
        return warn(
          "image-digest",
          `${tagged[0][1]} is not pinned by digest. Images are deployed by signed digest, never by tag. ` +
            "Instead, reference it as name@sha256:<digest> from the release lock.",
        );
      }
    }
  }
  return null;
}

// Heredoc bodies are data, not shell words: scan only up to the line that
// opens the first heredoc.
function shellText(command) {
  const start = command.indexOf("<<");
  if (start < 0) return command;
  const newline = command.indexOf("\n", start);
  return newline < 0 ? command : command.slice(0, newline);
}

// An unquoted glob in --include/--exclude: zsh expands it and, when nothing
// matches, fails the whole command before it runs. Blocks: every warning in
// the 2026-11-08 retrospective was heeded and none was overridden.
const UNQUOTED_GLOB = /(?:^|\s)--(include|exclude)=([^\s'"]*\*[^\s'"]*)/;

function unquotedGlob(command) {
  const match = UNQUOTED_GLOB.exec(shellText(command));
  if (!match) return null;
  return block(
    "unquoted-glob",
    `--${match[1]}=${match[2]} is unquoted; zsh fails the whole command when the glob matches no file. ` +
      `Instead, quote it: --${match[1]}='${match[2]}'.`,
  );
}

const WORD_BREAK = new Set([
  " ",
  "\t",
  "\n",
  ";",
  "&",
  "|",
  "(",
  ")",
  "<",
  ">",
]);

// $?, $*, $#, $@ and the other special parameters expand before globbing.
const SPECIAL_PARAMETER = /^[?*#@!$0-9-]$/;

/** Raw shell words, noting an unquoted * or ? and an unquoted leading =. */
function rawWords(command) {
  const words = [];
  let word = null;
  let quote = null;
  const start = () => (word ??= { text: "", glob: false, equals: false });
  const end = () => {
    if (word) words.push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') word.text += command[++i] ?? "";
      else word.text += char;
    } else if (char === "'" || char === '"') {
      start();
      quote = char;
    } else if (char === "\\") {
      start().text += command[++i] ?? "";
    } else if (WORD_BREAK.has(char)) {
      end();
    } else if (char === "$" && SPECIAL_PARAMETER.test(command[i + 1] ?? "")) {
      start().text += char + command[++i];
    } else {
      start();
      if (char === "*" || char === "?") word.glob = true;
      if (
        char === "=" &&
        word.text === "" &&
        /[^\s]/.test(command[i + 1] ?? " ")
      )
        word.equals = true;
      word.text += char;
    }
  }
  end();
  return words;
}

// zsh pitfalls beyond --include/--exclude, in audit mode (warn): a bare glob
// that matches nothing fails with "no matches found", and a word starting
// with = is expanded as a command lookup ("== not found").
function zshWords(command) {
  const text = shellText(command).replace(/\$\(\([^)]*\)\)/g, "");
  for (const word of rawWords(text)) {
    if (word.glob && !word.text.includes("${")) {
      return warn(
        "bare-glob",
        `${word.text} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
          `Instead, quote it ('${word.text}') unless it must expand, and check that it matches.`,
      );
    }
    if (word.equals && !text.includes("[[")) {
      return warn(
        "equals-word",
        `${word.text} starts with an unquoted =, which zsh expands as a command lookup ("${word.text.slice(1)} not found"). ` +
          `Instead, quote it: '${word.text}'.`,
      );
    }
  }
  return null;
}

/** Decide on one tool call. Returns {action: "allow" | "warn" | "block", rule?, message?}. */
export function evaluate(call, ctx) {
  const tool = call?.tool_name;
  const input = call?.tool_input ?? {};

  if (tool === "Bash" && typeof input.command === "string") {
    const glob = unquotedGlob(input.command);
    if (glob) return glob;
    let warning = null;
    for (const segment of splitSegments(input.command)) {
      const result = checkBashSegment(segment, ctx);
      if (result?.action === "block") return result;
      warning ??= result;
    }
    return warning ?? zshWords(input.command) ?? allow;
  }

  if (
    ["Read", "Write", "Edit"].includes(tool) &&
    typeof input.file_path === "string"
  ) {
    const prefix = `${ctx.root}/`;
    const relative = input.file_path.startsWith(prefix)
      ? input.file_path.slice(prefix.length)
      : input.file_path;
    return checkFile(tool, input, relative, ctx) ?? allow;
  }

  return allow;
}

function main() {
  let call;
  try {
    call = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const root = process.env.CLAUDE_PROJECT_DIR || call.cwd || process.cwd();
  const result = evaluate(call, {
    root,
    readFile: (path) => readFileSync(path, "utf8"),
  });

  if (result.action === "block") {
    process.stderr.write(`${result.message}\n`);
    return 2;
  }
  if (result.action === "warn") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: result.message,
        },
      }),
    );
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}

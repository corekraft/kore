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
    checkNoVerify(name, args)
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

// An unquoted glob in --include/--exclude: zsh expands it and, when nothing
// matches, fails the whole command before it runs. Audit mode (warn).
const UNQUOTED_GLOB = /(?:^|\s)--(include|exclude)=([^\s'"]*\*[^\s'"]*)/;

function unquotedGlob(command) {
  const match = UNQUOTED_GLOB.exec(command);
  if (!match) return null;
  return warn(
    "unquoted-glob",
    `--${match[1]}=${match[2]} is unquoted; zsh fails the whole command when the glob matches no file. ` +
      `Instead, quote it: --${match[1]}='${match[2]}'.`,
  );
}

/** Decide on one tool call. Returns {action: "allow" | "warn" | "block", rule?, message?}. */
export function evaluate(call, ctx) {
  const tool = call?.tool_name;
  const input = call?.tool_input ?? {};

  if (tool === "Bash" && typeof input.command === "string") {
    let warning = unquotedGlob(input.command);
    for (const segment of splitSegments(input.command)) {
      const result = checkBashSegment(segment, ctx);
      if (result?.action === "block") return result;
      warning ??= result;
    }
    return warning ?? allow;
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

#!/usr/bin/env node
// Deterministic retrospective scan: counts over session transcripts that the
// retro skill interprets. Prints JSON with rule names, tool names, and short
// error summaries; never user or assistant text. Node standard library only.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan
//
// Usage: node .claude/hooks/retro-scan.mjs [--dir <transcripts>] [--since YYYY-MM-DD]

import { createHash } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { lastRetrospective, readPlans, windowStart } from "./context.mjs";

const USAGE =
  "Usage: node .claude/hooks/retro-scan.mjs [--dir <transcripts>] [--since YYYY-MM-DD]\n--since keeps sessions active at or after local midnight of that date, like the session-start count.";
const MAX_ERROR = 120;
const MIN_WARNINGS = 5;
const MIN_CORRECTION_WORDS = 4;
const GUARD_TAG = /\[guard:([a-z0-9-]+)\]/g;

/** Rules the guard runs in audit mode: the literal names passed to warn(). */
export function auditRules(guardSource) {
  const names = [...guardSource.matchAll(/\bwarn\(\s*"([a-z0-9-]+)"/g)].map(
    (match) => match[1],
  );
  return [...new Set(names)].sort();
}

/** Parse JSONL, keeping the 1-based line number; malformed lines are counted. */
export function parseTranscript(id, text) {
  const events = [];
  let skipped = 0;
  text.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") return;
    try {
      const value = JSON.parse(raw);
      if (value === null || typeof value !== "object")
        throw new Error("not an object");
      events.push({ ...value, line: index + 1 });
    } catch {
      skipped++;
    }
  });
  return { id, events, skipped };
}

const ERROR_WORDS =
  /\b(errors?|fail(ed|ure|ures)?|fatal|not found|no such|denied|cannot|invalid|refused|no matches)\b/i;
const SHELL_PREFIX = /^(\(eval\):\d+:|zsh:|bash:|sh:)/;
const NOT_OUTPUT_ERROR = /^(- |#|import |export |\|)/;

/** Whether a line of command output reads as an error rather than stdout, Markdown, or code. */
const looksLikeError = (line) =>
  !NOT_OUTPUT_ERROR.test(line) &&
  (ERROR_WORDS.test(line) || SHELL_PREFIX.test(line));

/**
 * Reduce an error to a stable, short summary: the first line (plus a shell
 * error line after an exit code), with paths, quoted text, globs, and numbers
 * replaced by placeholders.
 */
export function summarizeError(text) {
  const lines = String(text)
    .replace(/<\/?tool_use_error>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let head = lines[0] ?? "";
  let prefix = "";
  const exit = /^Exit code \d+$/.exec(head);
  if (exit) {
    prefix = head;
    head = lines.slice(1).find(looksLikeError) ?? "";
  }
  const normalized = head
    .replace(/'[^']*'|"[^"]*"/g, "<q>")
    .replace(/(^|[\s(=])\/[^\s)]*/g, "$1<path>")
    .replace(/(^|\s)\S*\*\S*/g, "$1<glob>")
    .replace(/\b\d+\b/g, "N");
  const joined =
    prefix && normalized ? `${prefix}: ${normalized}` : prefix || normalized;
  return joined.slice(0, MAX_ERROR);
}

const blocksOf = (event) =>
  Array.isArray(event.message?.content) ? event.message.content : [];

const resultText = (block) => {
  const { content } = block;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((part) => part?.text ?? "").join("\n");
  return "";
};

const callSignature = (input = {}) =>
  JSON.stringify(input.command ?? input.new_string ?? input.content ?? input);

/** The user's own typed text, or null for tool results, commands, and injected text. */
function humanText(event) {
  if (
    event.type !== "user" ||
    event.isSidechain ||
    event.isMeta ||
    event.isCompactSummary
  ) {
    return null;
  }
  if (event.origin && event.origin.kind !== "human") return null;
  const content = event.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n")
        : "";
  if (
    text.trim() === "" ||
    /^\s*<(command-|local-command|task-notification)/.test(text)
  ) {
    return null;
  }
  return text;
}

const CORRECTION_WORD =
  /\b(no|not|dont|don't|don’t|stop|instead|wrong|again|actually|should|never)\b/i;

/** The user's words without pasted content and injected reminders. */
const ownWords = (text) =>
  text
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, " ")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ");

const phrasesOf = (text) =>
  text
    .split(/[.!?;\n]+/)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/['’`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    )
    .filter((phrase) => phrase.split(" ").length >= MIN_CORRECTION_WORDS);

function timestamps(session) {
  const stamps = session.events
    .map((event) => event.timestamp)
    .filter(Boolean)
    .sort();
  return { first: stamps[0] ?? null, last: stamps.at(-1) ?? null };
}

function analyzeSession(session) {
  const calls = new Map();
  const guards = {};
  const failures = [];
  const skills = new Set();
  const slashCommands = [];
  const phrases = [];
  const warnings = [];
  const ordered = [];
  let failedSinceHuman = false;
  const bump = (rule, key) => {
    guards[rule] ??= { blocks: 0, warnings: 0 };
    guards[rule][key]++;
  };

  for (const event of session.events) {
    for (const block of blocksOf(event)) {
      if (event.type === "assistant" && block.type === "tool_use") {
        calls.set(block.id, block.name);
        ordered.push({
          kind: "call",
          id: block.id,
          name: block.name,
          signature: callSignature(block.input),
        });
        if (block.name === "Skill" && block.input?.skill)
          skills.add(block.input.skill);
      } else if (
        event.type === "user" &&
        block.type === "tool_result" &&
        block.is_error
      ) {
        failedSinceHuman = true;
        const text = resultText(block);
        const tags = [...text.matchAll(GUARD_TAG)];
        if (tags.length > 0) {
          for (const tag of new Set(tags.map((match) => match[1])))
            bump(tag, "blocks");
        } else {
          failures.push({
            tool: calls.get(block.tool_use_id) ?? "unknown",
            error: summarizeError(text),
          });
        }
      }
    }
    const attachment = event.attachment;
    if (
      event.type === "attachment" &&
      attachment?.type === "hook_additional_context"
    ) {
      const text = [attachment.content].flat().join("\n");
      for (const tag of [...text.matchAll(GUARD_TAG)]) {
        bump(tag[1], "warnings");
        warnings.push({
          rule: tag[1],
          toolUseId: attachment.toolUseID,
          at: ordered.length,
        });
      }
    }
    const text = humanText(event);
    if (text !== null) {
      ordered.push({ kind: "human" });
      const own = ownWords(text);
      // A repeated prompt is only a correction if it reads like one or follows a failure.
      if (failedSinceHuman || CORRECTION_WORD.test(own)) {
        for (const phrase of phrasesOf(own))
          phrases.push({ phrase, line: event.line });
      }
      failedSinceHuman = false;
    }
    const slash =
      typeof event.message?.content === "string" && event.type === "user"
        ? /<command-name>\/?([a-z0-9:-]+)<\/command-name>/.exec(
            event.message.content,
          )
        : null;
    if (slash) slashCommands.push(slash[1]);
  }
  return {
    guards,
    failures,
    skills,
    slashCommands,
    phrases,
    warnings,
    ordered,
  };
}

/** What the agent did after one warning: heeded, repeated, overridden, or unresolved. */
function outcome(warning, ordered) {
  const call = ordered.findIndex(
    (item) => item.kind === "call" && item.id === warning.toolUseId,
  );
  if (call === -1) return "unresolved";
  const warned = ordered[call];
  for (const item of ordered.slice(call + 1)) {
    if (item.kind === "human") return "overridden";
    if (item.name === warned.name)
      return item.signature === warned.signature ? "repeated" : "heeded";
  }
  return "unresolved";
}

/**
 * Scan sessions ({ id, text }) into the report. Options: since (YYYY-MM-DD,
 * sessions that ended before local midnight of that date are left out), knownSkills, auditRules.
 */
export function scan(
  inputs,
  { since, knownSkills = [], auditRules: audit = [] } = {},
) {
  const parsed = inputs.map(({ id, text }) => parseTranscript(id, text));
  const included = parsed
    .map((session) => ({ session, ...timestamps(session) }))
    .filter(
      ({ last }) => last !== null && Date.parse(last) >= windowStart(since),
    )
    .sort((a, b) => a.first.localeCompare(b.first));

  const guards = {};
  const failureCounts = new Map();
  const perSession = {};
  const loaded = new Set();
  const phraseSessions = new Map();
  const ruleStats = new Map(
    audit.map((rule) => [
      rule,
      {
        warnings: 0,
        sessions: 0,
        heeded: 0,
        overridden: 0,
        repeated: 0,
        unresolved: 0,
      },
    ]),
  );

  for (const { session } of included) {
    const found = analyzeSession(session);
    for (const [rule, counts] of Object.entries(found.guards)) {
      guards[rule] ??= { blocks: 0, warnings: 0 };
      guards[rule].blocks += counts.blocks;
      guards[rule].warnings += counts.warnings;
    }
    for (const { tool, error } of found.failures) {
      const key = `${tool}\u0000${error}`;
      failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
    }
    const used = new Set([
      ...found.skills,
      ...found.slashCommands.filter((name) => knownSkills.includes(name)),
    ]);
    for (const name of used) loaded.add(name);
    if (used.size > 0) perSession[session.id] = [...used].sort();
    const seen = new Set();
    for (const { phrase, line } of found.phrases) {
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      const entry = phraseSessions.get(phrase) ?? [];
      entry.push({ session: session.id, line });
      phraseSessions.set(phrase, entry);
    }
    const touched = new Set();
    for (const warning of found.warnings) {
      const stats = ruleStats.get(warning.rule);
      if (!stats) continue;
      stats.warnings++;
      stats[outcome(warning, found.ordered)]++;
      touched.add(warning.rule);
    }
    for (const rule of touched) ruleStats.get(rule).sessions++;
  }

  const failures = [...failureCounts]
    .map(([key, count]) => {
      const [tool, error] = key.split("\u0000");
      return { tool, error, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Phrases from the same messages are one correction, so merge identical evidence.
  const byEvidence = new Map();
  for (const [phrase, evidence] of phraseSessions) {
    if (evidence.length < 2) continue;
    const key = JSON.stringify(evidence);
    const group = byEvidence.get(key) ?? { phrases: [], evidence };
    group.phrases.push(phrase);
    byEvidence.set(key, group);
  }
  const corrections = [...byEvidence.values()]
    .map(({ phrases, evidence }) => ({
      id: createHash("sha1")
        .update(phrases.sort().join("\n"))
        .digest("hex")
        .slice(0, 8),
      sessions: evidence.length,
      evidence,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const rules = [...ruleStats]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, stats]) => {
      let status = "insufficient-evidence";
      if (stats.warnings >= MIN_WARNINGS) {
        status =
          stats.heeded === stats.warnings ? "promotable" : "not-promotable";
      }
      return { rule, status, ...stats };
    });

  return {
    sessions: {
      count: included.length,
      first: included.map((item) => item.first).sort()[0] ?? null,
      last:
        included
          .map((item) => item.last)
          .sort()
          .at(-1) ?? null,
      list: included.map(({ session, first, last }) => ({
        id: session.id,
        first,
        last,
      })),
    },
    skippedLines: included.reduce((sum, item) => sum + item.session.skipped, 0),
    guards: Object.fromEntries(
      Object.entries(guards).sort(([a], [b]) => a.localeCompare(b)),
    ),
    failures,
    skills: {
      perSession,
      unused: knownSkills.filter((name) => !loaded.has(name)).sort(),
    },
    corrections,
    rules: {
      promotable: rules
        .filter((r) => r.status === "promotable")
        .map((r) => r.rule),
      audit: rules,
    },
  };
}

// --- command line ---------------------------------------------------------

const root = fileURLToPath(new URL("../../", import.meta.url));

function parseArgs(argv) {
  const args = { dir: null, since: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) args.dir = argv[++i];
    else if (
      argv[i] === "--since" &&
      /^\d{4}-\d{2}-\d{2}$/.test(argv[i + 1] ?? "")
    )
      args.since = argv[++i];
    else return null;
  }
  return args;
}

const PROBE_BYTES = 256 * 1024;
const DEFAULT_BRANCHES = new Set(["main", "master", "HEAD"]);

/** Claude names a project directory after its cwd with every non-alphanumeric replaced by "-". */
const encodePath = (path) => path.replace(/[^a-zA-Z0-9]/g, "-");

const insideOf = (path, base) => path === base || path.startsWith(base + sep);

/** The first bytes of a transcript, enough to hold its first events. */
function probe(file) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(PROBE_BYTES);
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, PROBE_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Transcript directories under projectsDir whose sessions belong to the
 * repository ({ main, worktrees, branches }). Claude files a session under its
 * cwd, and worktrees are removed after use, so a directory name alone is not
 * enough. A directory qualifies when any of its transcripts shows one of:
 *   1. its name encodes the main checkout or a live worktree (git worktree list);
 *   2. a recorded cwd inside the main checkout or a live worktree, which covers
 *      removed worktrees under .claude/worktrees/;
 *   3. a recorded gitBranch that is a branch of this repository, other than
 *      main/master (which every repository has, so it would claim foreign work);
 *   4. the main checkout's absolute path in the first 256 KB, which covers a
 *      removed worktree outside the repository on a since-deleted branch.
 * Rules 3 and 4 are heuristics and favor over-inclusion; the retro skill reads
 * only the transcripts the scan names.
 */
export function repoTranscriptDirs(projectsDir, { main, worktrees, branches }) {
  const roots = [...new Set([main, ...worktrees])];
  const names = new Set(roots.map(encodePath));
  const branchSet = new Set(branches.filter((b) => !DEFAULT_BRANCHES.has(b)));
  let entries;
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const belongs = (dir) => {
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return false;
    }
    return files.some((file) => {
      let head;
      try {
        head = probe(join(dir, file));
      } catch {
        return false;
      }
      if (head.includes(main)) return true;
      for (const line of head.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (
            typeof event?.cwd === "string" &&
            roots.some((root) => insideOf(event.cwd, root))
          )
            return true;
          if (branchSet.has(event?.gitBranch)) return true;
        } catch {
          // A partial last line or a foreign line proves nothing.
        }
      }
      return false;
    });
  };
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(projectsDir, entry.name))
    .filter((dir) => names.has(basename(dir)) || belongs(dir))
    .sort();
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

/** The repository's transcript directories: the main checkout and every worktree, live or removed. */
function defaultDirs() {
  const worktrees = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  const common = git([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]).trim();
  const main = worktrees[0] ?? (common ? join(common, "..") : root);
  const branches = git([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ])
    .split("\n")
    .filter(Boolean)
    .map((name) => name.replace(/^origin\//, ""));
  return repoTranscriptDirs(join(homedir(), ".claude", "projects"), {
    main,
    worktrees: worktrees.length > 0 ? worktrees : [main],
    branches,
  });
}

function lastRetrospectiveDate() {
  return lastRetrospective(readPlans(root)) ?? undefined;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  const dirs = args.dir ? [args.dir] : defaultDirs();
  const since = args.since ?? (args.dir ? undefined : lastRetrospectiveDate());
  const byId = new Map();
  try {
    for (const dir of dirs) {
      for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
        const id = basename(name, ".jsonl");
        const text = readFileSync(join(dir, name), "utf8");
        // A resumed session can appear in two directories; keep the fuller one.
        if (text.length >= (byId.get(id)?.text.length ?? -1))
          byId.set(id, { id, text });
      }
    }
  } catch {
    console.error(
      `Cannot read transcripts in ${dirs.join(", ") || "any project directory"}. Pass --dir <transcripts>.\n${USAGE}`,
    );
    return 2;
  }
  if (!args.dir && byId.size === 0) {
    console.error(
      "No transcripts found for this repository or its worktrees. Pass --dir <transcripts>.\n" +
        USAGE,
    );
    return 2;
  }
  const inputs = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  let knownSkills = [];
  try {
    knownSkills = readdirSync(join(root, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.error("No skills/ directory found; skills.unused will be empty.");
  }
  const guardSource = readFileSync(
    new URL("./guard.mjs", import.meta.url),
    "utf8",
  );
  if (since === undefined && !args.dir) {
    console.error(
      "No `Last retrospective:` date found; scanning all sessions. Pass --since to narrow.",
    );
  }
  const report = scan(inputs, {
    since,
    knownSkills,
    auditRules: auditRules(guardSource),
  });
  console.log(JSON.stringify({ since: since ?? null, ...report }, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));

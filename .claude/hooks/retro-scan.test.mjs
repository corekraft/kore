// Deterministic retrospective scan: counts over session transcripts that the
// retro skill interprets. Fixtures in fixtures/retro/ are synthetic.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditRules,
  parseTranscript,
  scan,
  summarizeError,
} from "./retro-scan.mjs";

const hook = fileURLToPath(new URL("./retro-scan.mjs", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/retro/", import.meta.url));
const guardSource = readFileSync(
  new URL("./guard.mjs", import.meta.url),
  "utf8",
);

const fixture = (name) => ({
  id: name,
  text: readFileSync(`${fixtures}${name}.jsonl`, "utf8"),
});
const all = () => ["alpha", "bravo", "charlie"].map(fixture);
const options = {
  since: "2026-10-31",
  knownSkills: ["handoff", "retro", "test-driven-development", "write-adr"],
  auditRules: ["image-digest", "sample-audit", "unquoted-glob"],
};

test("a malformed transcript line is skipped and counted, not fatal", () => {
  const session = parseTranscript("alpha", fixture("alpha").text);
  assert.equal(session.skipped, 1);
  assert.ok(session.events.length > 30);
});

test("sessions before the since date are left out, with first and last timestamps", () => {
  const result = scan(all(), options);
  assert.deepEqual(
    result.sessions.list.map((session) => session.id),
    ["alpha", "bravo"],
  );
  assert.equal(result.sessions.count, 2);
  assert.equal(result.sessions.first, "2026-11-01T10:01:00.000Z");
  assert.match(result.sessions.last, /^2026-11-02T/);
  assert.equal(result.skippedLines, 1);
});

test("guard warnings and blocks are counted per rule, ignoring guard text inside file contents", () => {
  const { guards } = scan(all(), options);
  assert.deepEqual(guards, {
    "image-digest": { blocks: 0, warnings: 5 },
    "kubectl-context": { blocks: 1, warnings: 0 },
    "sample-audit": { blocks: 0, warnings: 2 },
    "unquoted-glob": { blocks: 0, warnings: 5 },
  });
});

test("failed tool calls are grouped by tool and normalized error, guard blocks excluded", () => {
  const { failures } = scan(all(), options);
  assert.deepEqual(failures, [
    { tool: "Edit", error: "String to replace not found in file.", count: 2 },
    {
      tool: "Bash",
      error: "Exit code 1: (eval):N: no matches found: <glob>",
      count: 1,
    },
  ]);
});

test("failures are capped at the top ten", () => {
  const lines = [];
  for (let n = 0; n < 12; n++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-03T00:00:00.000Z",
        message: {
          content: [
            { type: "tool_use", id: `t${n}`, name: `Tool${n}`, input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-03T00:00:00.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: `t${n}`,
              is_error: true,
              content: "boom",
            },
          ],
        },
      }),
    );
  }
  const { failures } = scan([{ id: "many", text: lines.join("\n") }], options);
  assert.equal(failures.length, 10);
});

test("error summaries strip paths, numbers, and quotes, and stay within 120 characters", () => {
  assert.equal(
    summarizeError(
      "<tool_use_error>File /repo/a/b.ts has 42 lines and 'x y'</tool_use_error>",
    ),
    "File <path> has N lines and <q>",
  );
  assert.equal(summarizeError("Exit code 137"), "Exit code 137");
  assert.equal(
    summarizeError("Exit code 1\nsome file contents\nmore contents"),
    "Exit code 1",
  );
  assert.ok(summarizeError(`Error ${"word ".repeat(80)}`).length <= 120);
});

test("skills loaded per session count Skill calls and skill slash commands, not built-in commands", () => {
  const { skills } = scan(all(), options);
  assert.deepEqual(skills.perSession, {
    alpha: ["retro", "test-driven-development"],
    bravo: ["handoff"],
  });
});

test("skills in skills/ that no scanned session loaded are reported unused", () => {
  assert.deepEqual(scan(all(), options).skills.unused, ["write-adr"]);
  assert.deepEqual(
    scan(all(), { ...options, since: undefined }).skills.unused,
    [],
  );
});

test("a correction phrase repeated in two sessions is reported by location, without its text", () => {
  const { corrections } = scan(all(), options);
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].sessions, 2);
  assert.deepEqual(
    corrections[0].evidence.map((item) => item.session),
    ["alpha", "bravo"],
  );
  assert.ok(
    corrections[0].evidence.every((item) => Number.isInteger(item.line)),
  );
  assert.doesNotMatch(JSON.stringify(corrections), /push|remote/);
});

test("pasted content and compaction summaries are not the user's own words", () => {
  const { corrections } = scan(all(), { ...options, since: undefined });
  assert.equal(corrections.length, 1);
});

test("an audit rule whose warnings were all heeded across five or more warnings is promotable", () => {
  const { rules } = scan(all(), options);
  assert.deepEqual(rules.promotable, ["unquoted-glob"]);
  assert.deepEqual(
    rules.audit.find((rule) => rule.rule === "unquoted-glob"),
    {
      rule: "unquoted-glob",
      status: "promotable",
      warnings: 5,
      sessions: 2,
      heeded: 5,
      overridden: 0,
      repeated: 0,
      unresolved: 0,
    },
  );
});

test("an audit rule the user overrode once is not promotable", () => {
  const rule = scan(all(), options).rules.audit.find(
    (entry) => entry.rule === "image-digest",
  );
  assert.equal(rule.status, "not-promotable");
  assert.equal(rule.warnings, 5);
  assert.equal(rule.overridden, 1);
  assert.equal(rule.heeded, 4);
});

test("an audit rule with fewer than five warnings is insufficient evidence, even if repeated", () => {
  const rule = scan(all(), options).rules.audit.find(
    (entry) => entry.rule === "sample-audit",
  );
  assert.equal(rule.status, "insufficient-evidence");
  assert.equal(rule.warnings, 2);
  assert.equal(rule.repeated, 1);
});

test("an audit rule with no warnings at all is still listed as insufficient evidence", () => {
  const { rules } = scan([fixture("charlie")], {
    ...options,
    since: undefined,
  });
  assert.ok(
    rules.audit.every((rule) => rule.status === "insufficient-evidence"),
  );
  assert.equal(rules.audit.length, 3);
});

test("the audit-mode rules are read from the guard's warn calls", () => {
  assert.deepEqual(auditRules(guardSource), ["image-digest", "unquoted-glob"]);
});

test("the CLI scans a directory and prints JSON without user text", () => {
  const result = spawnSync(process.execPath, [hook, "--dir", fixtures], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sessions.count, 3);
  assert.equal(report.since, null);
  assert.ok(Array.isArray(report.skills.unused));
  assert.doesNotMatch(
    result.stdout,
    /push to the remote|widget tag|shared stash/,
  );
});

test("the CLI applies --since to a directory", () => {
  const result = spawnSync(
    process.execPath,
    [hook, "--dir", fixtures, "--since", "2026-11-01"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sessions.count, 1);
});

test("the CLI rejects an unknown flag with usage", () => {
  const result = spawnSync(process.execPath, [hook, "--bogus"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node \.claude\/hooks\/retro-scan\.mjs/);
});

test("a session from the day of the last retrospective is not scanned, matching the session-start count", () => {
  const result = scan(all(), { ...options, since: "2026-11-01" });
  assert.deepEqual(
    result.sessions.list.map((session) => session.id),
    ["bravo"],
  );
});

test("a command failure is grouped by the first error-looking line after its exit code, else by the exit code alone", () => {
  const failure = (id, output) => [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-03T00:00:00.000Z",
      message: { content: [{ type: "tool_use", id, name: "Bash", input: {} }] },
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-11-03T00:00:00.000Z",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            is_error: true,
            content: output,
          },
        ],
      },
    }),
  ];
  const text = [
    ...failure(
      "x1",
      "Exit code 1\ntotal 8\n# Kore\nnpm error missing script: build",
    ),
    ...failure("x2", "Exit code 1\nfatal: not a git repository"),
    ...failure("x3", "Exit code 2\nM .claude/evals/eval.mjs\n──────"),
    ...failure("x4", "Exit code 1\nzsh: command not found: foo"),
  ].join("\n");
  const { failures } = scan([{ id: "s", text }], options);
  assert.deepEqual(failures.map((item) => item.error).sort(), [
    "Exit code 1: fatal: not a git repository",
    "Exit code 1: npm error missing script: build",
    "Exit code 1: zsh: command not found: foo",
    "Exit code 2",
  ]);
});

test("several repeated phrases from the same messages are one correction, not several", () => {
  const message = (line, text) =>
    JSON.stringify({
      type: "user",
      timestamp: "2026-11-03T00:00:00.000Z",
      message: { role: "user", content: text },
      line,
    });
  const text = message(
    1,
    "Never touch the shared stash. Always ask before you push.",
  );
  const sessions = [
    { id: "p", text },
    { id: "q", text },
  ];
  const { corrections } = scan(sessions, options);
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].sessions, 2);
  assert.equal(corrections[0].evidence.length, 2);
});

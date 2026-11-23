import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EvalReport } from "../../src/delivery/index.js";
import { main } from "../../src/testing/index.js";

// The migration rules and the N-1 check run on a real git repository, with the two N-1 steps as
// fixture executables that log what they receive. A failing step proves the release is refused.
const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const digest = `sha256:${"e".repeat(64)}`;
const version = "1.2.3+abc1234";
const today = "2026-11-23";
const SCRATCH_URL = "postgres://eval:hunter2@scratch.kore.internal:5432/eval";
const EXPAND_CONTRACT = "Safety-pattern: expand-contract";

let app: string;
let scratch: string;
let base: string;
let written: string[];
let applyLog: string;

// Under a git hook GIT_DIR names the real repository, so the fixture's git runs without GIT_* (#368).
const inheritedGit = Object.entries(process.env).filter(([name]) =>
  name.startsWith("GIT_"),
);

const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-C",
      app,
      "-c",
      "user.name=kore-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith("GIT_"),
        ),
      ),
    },
  );

/** An executable script that logs its database URL and exits with the given code. */
async function script(name: string, body: string): Promise<string> {
  const path = join(scratch, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

/** The apply step records each run in the log, with the URL it was given. */
async function applyStep(exitCode = 0): Promise<string> {
  return script(
    "apply",
    `printf 'apply %s\\n' "$DATABASE_URL" >> "${applyLog}"\nexit ${exitCode}`,
  );
}

/** The previous suite fails by naming the URL on stderr, which the eval must redact. */
async function suiteStep(exitCode = 0): Promise<string> {
  return script(
    "suite",
    `echo "suite could not reach $DATABASE_URL" >&2\nexit ${exitCode}`,
  );
}

/** Commits the given files as the head, with the trailers under the subject. */
async function commitHead(
  files: Record<string, string>,
  trailers: string[],
): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(app, path)), { recursive: true });
    await writeFile(join(app, path), text);
  }
  git("add", "-A");
  git(
    "commit",
    "--quiet",
    "-m",
    ["feat: add the note table", "", ...trailers].join("\n"),
  );
}

async function evalApp(extra: string[] = []) {
  const code = await main([
    "eval",
    app,
    "--base",
    base,
    "--version",
    version,
    "--digest",
    digest,
    "--today",
    today,
    ...extra,
  ]);
  const text = written.join("");
  const report: EvalReport = JSON.parse(text);
  return { code, report, text };
}

beforeEach(async () => {
  for (const [name] of inheritedGit) {
    delete process.env[name];
  }
  process.env.KORE_EVAL_SCRATCH_DATABASE_URL = SCRATCH_URL;
  app = await mkdtemp(join(tmpdir(), "kore-eval-migrations-"));
  scratch = await mkdtemp(join(tmpdir(), "kore-eval-scratch-"));
  applyLog = join(scratch, "apply.log");
  git("init", "--quiet");
  await cp(join(fixture, "src"), join(app, "src"), { recursive: true });
  // The base declares the fixture's flag, so a head that keeps it is not a new flag.
  await writeFile(
    join(app, "flags.yaml"),
    await readFile(join(fixture, "flags.json"), "utf8"),
  );
  git("add", "-A");
  git("commit", "--quiet", "-m", "chore: start the checkout");
  base = git("rev-parse", "HEAD").trim();
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  delete process.env.KORE_EVAL_SCRATCH_DATABASE_URL;
  for (const [name, value] of inheritedGit) {
    process.env[name] = value;
  }
  vi.restoreAllMocks();
  await rm(app, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

const N1 = async (apply: string, suite: string) => [
  "--carries-plan",
  "--n1-apply",
  apply,
  "--n1-previous-suite",
  suite,
];

test("an expand-only carrier passes, attests its plan exactly, and the N-1 steps run against the scratch URL, which the report never shows", async () => {
  await commitHead(
    {
      "migrations/0002-add-note.sql":
        "create table note (id bigint primary key);\n",
    },
    [EXPAND_CONTRACT],
  );
  const { code, report, text } = await evalApp(
    await N1(await applyStep(), await suiteStep()),
  );
  expect(code).toBe(0);
  expect(report.verdict).toBe("pass");
  expect(report.attestations?.["migration-plan"]).toEqual({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: version, digest: { sha256: "e".repeat(64) } }],
    predicateType: "urn:kore:migration-plan:v1",
    predicate: {
      release: "expand",
      migrationsPath: "migrations/",
      migrations: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
      contract: null,
      n1: "passed",
    },
  });
  expect(await readFile(applyLog, "utf8")).toBe(`apply ${SCRATCH_URL}\n`);
  expect(text).not.toContain("hunter2");
});

test("a previous-suite failure refuses the release with no payload, names the step, and redacts the URL", async () => {
  await commitHead(
    {
      "migrations/0002-add-note.sql":
        "create table note (id bigint primary key);\n",
    },
    [EXPAND_CONTRACT],
  );
  const { code, report, text } = await evalApp(
    await N1(await applyStep(), await suiteStep(1)),
  );
  expect(code).toBe(1);
  expect(report.verdict).toBe("fail");
  expect(report.failures).toEqual([
    "N-1 check: the previous release's suite failed (exit 1): suite could not reach <redacted>",
  ]);
  expect(report).not.toHaveProperty("attestations");
  expect(text).not.toContain("hunter2");
});

test("a release that adds a migration but gives no N-1 inputs is refused, naming the three inputs", async () => {
  await commitHead(
    {
      "migrations/0002-add-note.sql":
        "create table note (id bigint primary key);\n",
    },
    [EXPAND_CONTRACT],
  );
  const { code, report } = await evalApp(["--carries-plan"]);
  expect(code).toBe(1);
  expect(report.failures).toEqual([
    "the N-1 check needs --n1-apply <executable>, --n1-previous-suite <executable> and KORE_EVAL_SCRATCH_DATABASE_URL; missing: --n1-apply, --n1-previous-suite",
  ]);
});

test("an image that does not carry the plan attests the empty plan, even when the diff adds a migration, and runs no N-1 check", async () => {
  await commitHead(
    {
      "migrations/0002-add-note.sql":
        "create table note (id bigint primary key);\n",
    },
    [EXPAND_CONTRACT],
  );
  const { code, report } = await evalApp();
  expect(code).toBe(0);
  expect(report.attestations?.["migration-plan"].predicate).toEqual({
    release: "none",
    migrationsPath: null,
    migrations: [],
    contract: null,
    n1: "not-applicable",
  });
});

test("a contract migration in a normal release is refused, naming the file and its statement", async () => {
  await commitHead(
    { "migrations/0002-drop-old.sql": "drop table old_notes;\n" },
    [EXPAND_CONTRACT],
  );
  const { code, report } = await evalApp(
    await N1(await applyStep(), await suiteStep()),
  );
  expect(code).toBe(1);
  expect(report.failures).toEqual([
    "migration migrations/0002-drop-old.sql is a contract (not on the expand allowlist: drop table old_notes); a normal release carries only expand migrations, so a contract ships alone in its own release",
  ]);
});

test("a data contract passes with its declared window, attests its plan exactly, and runs the N-1 check", async () => {
  await commitHead(
    { "migrations/0003-drop-old.sql": "drop table old_notes;\n" },
    [
      EXPAND_CONTRACT,
      "Contract-release: data",
      "Contract-last-used: 1.2.2+def5678",
      "Contract-soak-hours: 24",
    ],
  );
  const { code, report } = await evalApp(
    await N1(await applyStep(), await suiteStep()),
  );
  expect(code).toBe(0);
  expect(report.attestations?.["migration-plan"].predicate).toEqual({
    release: "data-contract",
    migrationsPath: "migrations/",
    migrations: [{ path: "migrations/0003-drop-old.sql", class: "contract" }],
    contract: { lastUsed: "1.2.2+def5678", soakHours: 24, retiredFlags: [] },
    n1: "passed",
  });
});

test("a code contract retires a flag, attests its plan exactly, and runs no N-1 check", async () => {
  await commitHead(
    {
      "flags.yaml": '{"service": "leads", "flags": []}\n',
      "src/checkout.mjs": "export const checkout = () => 'plain';\n",
    },
    [
      EXPAND_CONTRACT,
      "Contract-release: code",
      "Contract-last-used: 1.2.2+def5678",
      "Contract-soak-hours: 6",
    ],
  );
  const { code, report } = await evalApp(
    await N1(await applyStep(), await suiteStep()),
  );
  expect(code).toBe(0);
  expect(report.attestations?.["migration-plan"].predicate).toEqual({
    release: "code-contract",
    migrationsPath: "migrations/",
    migrations: [],
    contract: {
      lastUsed: "1.2.2+def5678",
      soakHours: 6,
      retiredFlags: ["leads.new-checkout"],
    },
    n1: "not-applicable",
  });
  await expect(readFile(applyLog, "utf8")).rejects.toThrow();
});

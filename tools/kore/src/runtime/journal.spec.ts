import { mkdtemp, readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import {
  CommandError,
  RecordingRunner,
  type Runner,
  type RunResult,
} from "./runner.js";
import {
  JournalingRunner,
  readJournal,
  redactArgs,
  summarizeOperations,
  withJournal,
} from "./journal.js";

async function root(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "kore-journal-"));
}
async function lines(dir: string, environment = "local") {
  const text = await readFile(
    join(dir, ".kore", "state", "journal", `${environment}.jsonl`),
    "utf8",
  );
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("a successful operation journals start, exec, and end", async () => {
  const dir = await root();
  const inner = new RecordingRunner();
  await withJournal(
    { root: dir, environment: "local", command: "local up", context: "mk" },
    inner,
    async (runner) => {
      await runner.run("helm", ["upgrade", "--install", "x"]);
    },
  );
  const entries = await lines(dir);
  expect(entries.map((entry) => entry["kind"])).toEqual([
    "start",
    "exec",
    "end",
  ]);
  expect(entries[0]).toMatchObject({
    environment: "local",
    command: "local up",
    context: "mk",
  });
  expect(entries[1]).toMatchObject({
    command: "helm",
    args: ["upgrade", "--install", "x"],
    code: 0,
  });
  expect(entries[2]).toMatchObject({ outcome: "ok" });
  expect(new Set(entries.map((entry) => entry["op"])).size).toBe(1);
  expect(inner.calls).toHaveLength(1);
});

test("a failed operation journals the failure and rethrows it", async () => {
  const dir = await root();
  const failing: Runner = {
    async run(command, args) {
      const result: RunResult = { stdout: "", stderr: "boom\nsecond", code: 3 };
      throw new CommandError(command, args, result);
    },
  };
  await expect(
    withJournal(
      { root: dir, environment: "local", command: "cluster up" },
      failing,
      async (runner) => {
        await runner.run("minikube", ["start"]);
      },
    ),
  ).rejects.toThrow("minikube start failed");
  const entries = await lines(dir);
  expect(entries[0]).not.toHaveProperty("context");
  expect(entries[1]).toMatchObject({ kind: "exec", code: 3 });
  expect(entries[2]).toMatchObject({ kind: "end", outcome: "failed" });
  expect(String(entries[2]!["error"]).split("\n")).toHaveLength(1);
});

test("the journaled error is one line of at most 200 characters", async () => {
  const dir = await root();
  await expect(
    withJournal(
      { root: dir, environment: "local", command: "x" },
      new RecordingRunner(),
      async () => {
        throw new Error(`${"a".repeat(500)}\nsecond line`);
      },
    ),
  ).rejects.toThrow();
  const entries = await lines(dir);
  expect(String(entries[1]!["error"])).toHaveLength(200);
});

test("process input and env are never journaled, even when they hold a secret", async () => {
  const dir = await root();
  await withJournal(
    { root: dir, environment: "local", command: "secrets sync" },
    new RecordingRunner(),
    async (runner) => {
      await runner.run("sops", ["--decrypt"], {
        input: "hunter2-plaintext",
        env: { API_TOKEN: "env-secret-value" },
      });
    },
  );
  const text = await readFile(
    join(dir, ".kore", "state", "journal", "local.jsonl"),
    "utf8",
  );
  expect(text).not.toContain("hunter2-plaintext");
  expect(text).not.toContain("env-secret-value");
  expect(text).not.toContain("API_TOKEN");
});

test("flag values are redacted in both --flag=value and --flag value forms", () => {
  expect(
    redactArgs([
      "login",
      "--password=p1",
      "--api-token",
      "t2",
      "--Client-Secret=s3",
      "--ssh-key",
      "k4",
      "--namespace",
      "kore",
      "--keyring-only",
    ]),
  ).toEqual([
    "login",
    "--password=<redacted>",
    "--api-token",
    "<redacted>",
    "--Client-Secret=<redacted>",
    "--ssh-key",
    "<redacted>",
    "--namespace",
    "kore",
    "--keyring-only",
  ]);
});

test("redaction also applies to args journaled by the runner decorator and to failure text", async () => {
  const dir = await root();
  const failing: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "denied",
        code: 1,
      });
    },
  };
  await expect(
    withJournal(
      { root: dir, environment: "local", command: "x" },
      failing,
      async (runner) => {
        await runner.run("tool", ["--token=abc", "--password", "def"]);
      },
    ),
  ).rejects.toThrow();
  const text = await readFile(
    join(dir, ".kore", "state", "journal", "local.jsonl"),
    "utf8",
  );
  expect(text).not.toContain("abc");
  expect(text).not.toContain("def");
  expect(text).toContain("<redacted>");
});

test("a start-entry write failure stops the operation before the runner is called", async () => {
  const dir = await root();
  // A file where the journal directory must be makes the start write fail.
  await mkdir(join(dir, ".kore", "state"), { recursive: true });
  await writeFile(join(dir, ".kore", "state", "journal"), "not a directory");
  const inner = new RecordingRunner();
  const operation = vi.fn(async (runner: Runner) => {
    await runner.run("helm", ["list"]);
  });
  await expect(
    withJournal(
      { root: dir, environment: "local", command: "local up" },
      inner,
      operation,
    ),
  ).rejects.toThrow(/journal/);
  expect(operation).not.toHaveBeenCalled();
  expect(inner.calls).toEqual([]);
});

test("a write failure after start warns and lets the mutation finish", async () => {
  const dir = await root();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const inner = new RecordingRunner();
  const result = await withJournal(
    { root: dir, environment: "local", command: "local up" },
    inner,
    async (runner) => {
      // Make later appends fail by replacing the journal file with a directory.
      const path = join(dir, ".kore", "state", "journal", "local.jsonl");
      await chmod(path, 0o400);
      await runner.run("helm", ["list"]);
      return "finished";
    },
  );
  expect(result).toBe("finished");
  expect(inner.calls).toHaveLength(1);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("an operation with a start and no end is reported as interrupted", async () => {
  const dir = await root();
  const base = join(dir, ".kore", "state", "journal");
  await mkdir(base, { recursive: true });
  const fixture = [
    {
      ts: "2026-11-07T10:00:00.000Z",
      op: "a",
      kind: "start",
      environment: "local",
      command: "local up",
    },
    {
      ts: "2026-11-07T10:00:01.000Z",
      op: "a",
      kind: "exec",
      command: "helm",
      args: [],
      code: 0,
      ms: 5,
    },
    {
      ts: "2026-11-07T10:01:00.000Z",
      op: "b",
      kind: "start",
      environment: "local",
      command: "cluster stop",
    },
    {
      ts: "2026-11-07T10:01:02.000Z",
      op: "b",
      kind: "end",
      outcome: "failed",
      error: "nope",
      ms: 2000,
    },
    {
      ts: "2026-11-07T10:02:00.000Z",
      op: "c",
      kind: "start",
      environment: "local",
      command: "app up x",
    },
    {
      ts: "2026-11-07T10:02:01.000Z",
      op: "c",
      kind: "end",
      outcome: "ok",
      ms: 1000,
    },
  ];
  await writeFile(
    join(base, "local.jsonl"),
    `${fixture.map((entry) => JSON.stringify(entry)).join("\n")}\nnot json\n`,
  );
  const operations = summarizeOperations(await readJournal(dir, "local"));
  expect(operations.map((op) => [op.op, op.outcome])).toEqual([
    ["a", "interrupted"],
    ["b", "failed"],
    ["c", "ok"],
  ]);
  expect(operations[1]).toMatchObject({ error: "nope", ms: 2000 });
});

test("reading a missing journal yields no entries and writes nothing", async () => {
  const dir = await root();
  expect(await readJournal(dir, "local")).toEqual([]);
  await expect(
    readFile(join(dir, ".kore", "state", "journal", "local.jsonl")),
  ).rejects.toThrow();
});

test("the runner decorator records a failing command's exit code and rethrows", async () => {
  const dir = await root();
  const failing: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "x",
        code: 7,
      });
    },
  };
  const runner = new JournalingRunner(failing, {
    root: dir,
    environment: "local",
    op: "z",
  });
  await expect(runner.run("kubectl", ["get"])).rejects.toThrow();
  expect((await lines(dir))[0]).toMatchObject({ code: 7, command: "kubectl" });
});

// Integration: the journal writes and reads real .jsonl files under a temporary root (ADR 0098).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import {
  CommandError,
  readJournal,
  RecordingRunner,
  type Runner,
  summarizeOperations,
  withJournal,
} from "../src/runtime/index.js";

// Docs: infra/plans/6-agent-primitives.md#journal-format

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kore-journal-"));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function journalText(dir: string): Promise<string> {
  return await readFile(
    join(dir, ".kore", "state", "journal", "local.jsonl"),
    "utf8",
  );
}

async function lines(dir: string) {
  return (await journalText(dir))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("a successful operation is written as start, exec and end, and reads back as ok", async () => {
  const dir = await root();
  await withJournal(
    { root: dir, environment: "local", command: "local up", context: "mk" },
    new RecordingRunner(),
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
  expect(new Set(entries.map((entry) => entry["op"])).size).toBe(1);
  expect(summarizeOperations(await readJournal(dir, "local"))).toEqual([
    {
      op: entries[0]!["op"],
      command: "local up",
      ts: entries[0]!["ts"],
      outcome: "ok",
      ms: expect.any(Number),
    },
  ]);
});

test("a failed operation reads back as failed, with its one-line error", async () => {
  const dir = await root();
  const failing: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "boom\nsecond",
        code: 3,
      });
    },
  };
  await expect(
    withJournal(
      { root: dir, environment: "local", command: "cluster up" },
      failing,
      async (runner) => {
        await runner.run("k3d", ["cluster", "start"]);
      },
    ),
  ).rejects.toThrow("k3d cluster start failed");
  const [operation] = summarizeOperations(await readJournal(dir, "local"));
  expect(operation).toMatchObject({
    command: "cluster up",
    outcome: "failed",
    error: "k3d cluster start failed (3)",
  });
});

test("secret arguments, process input and env never reach the journal file", async () => {
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
        await runner.run("tool", ["--token=tok-qwz", "--password", "pw-jkv"], {
          input: "hunter2-plaintext",
          env: { API_TOKEN: "env-secret-value" },
        });
      },
    ),
  ).rejects.toThrow();
  const text = await journalText(dir);
  expect(text).not.toMatch(
    /tok-qwz|pw-jkv|hunter2-plaintext|env-secret-value|API_TOKEN/,
  );
  expect(text).toContain("<redacted>");
});

test("non-command error text is redacted before it reaches the journal file", async () => {
  const dir = await root();
  await expect(
    withJournal(
      { root: dir, environment: "local", command: "x" },
      new RecordingRunner(),
      async () => {
        throw new Error("wrapped: tool --set db.password=hunter2 failed");
      },
    ),
  ).rejects.toThrow();
  const text = await journalText(dir);
  expect(text).not.toContain("hunter2");
  expect(text).toContain("db.password=<redacted>");
});

test("a journal directory that is a file stops the operation before the runner is called", async () => {
  const dir = await root();
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
  ).rejects.toThrow(/cannot write the operations journal/);
  expect(operation).not.toHaveBeenCalled();
  expect(inner.calls).toEqual([]);
});

test("a journal file that cannot be written after start warns, and the mutation finishes", async () => {
  const dir = await root();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const inner = new RecordingRunner();
  const result = await withJournal(
    { root: dir, environment: "local", command: "local up" },
    inner,
    async (runner) => {
      // Replace the journal file with a directory, so later appends fail.
      const path = join(dir, ".kore", "state", "journal", "local.jsonl");
      await rm(path);
      await mkdir(path);
      await runner.run("helm", ["list"]);
      return "finished";
    },
  );
  expect(result).toBe("finished");
  expect(inner.calls).toHaveLength(1);
  expect(warn).toHaveBeenCalled();
});

test("a journal that stops after a start is read back as interrupted, skipping torn lines", async () => {
  const dir = await root();
  await mkdir(join(dir, ".kore", "state", "journal"), { recursive: true });
  const start = {
    ts: "2026-11-07T10:00:00.000Z",
    op: "a",
    kind: "start",
    environment: "local",
    command: "local up",
  };
  await writeFile(
    join(dir, ".kore", "state", "journal", "local.jsonl"),
    `${JSON.stringify(start)}\nnot json\n`,
  );
  expect(summarizeOperations(await readJournal(dir, "local"))).toEqual([
    {
      op: "a",
      command: "local up",
      ts: "2026-11-07T10:00:00.000Z",
      outcome: "interrupted",
    },
  ]);
});

test("reading a missing journal yields no entries and creates no file", async () => {
  const dir = await root();
  expect(await readJournal(dir, "local")).toEqual([]);
  await expect(journalText(dir)).rejects.toThrow(/ENOENT/);
});

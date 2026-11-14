// Docs: infra/plans/6-agent-primitives.md#journal-format
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  JournalingRunner,
  readJournal,
  redactArgs,
  summarizeOperations,
  withJournal,
} from "./journal.js";
import {
  appendedEntries,
  errno,
  failedEntries,
  journalEntry,
  journalText,
  JOURNAL,
  OP,
  okEntries,
  operationFixture,
  operationSummaries,
  redactionFixtures,
  ROOT,
  T0,
} from "./journal-support.js";
import { CommandError, type Runner } from "./runner.js";
import { fakeRunner } from "./runtime-support.js";

vi.mock("node:crypto");
vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("./runner.js", async (importOriginal) => ({
  // Real, because the journal tells a failed command apart with `instanceof`.
  CommandError: (await importOriginal<typeof import("./runner.js")>())
    .CommandError,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(randomUUID).mockReturnValue(OP);
  vi.mocked(readFile).mockRejectedValue(errno("ENOENT"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("a successful operation journals its start, exec and end entries in order, under one operation id", async () => {
  const { runner, run } = fakeRunner();
  await withJournal(
    { root: ROOT, environment: "local", command: "local up", context: "mk" },
    runner,
    async (journaled) => {
      await journaled.run("helm", ["upgrade", "--install", "x"]);
    },
  );
  expect(appendedEntries()).toEqual(okEntries);
  expect(run.mock.calls).toEqual([
    ["helm", ["upgrade", "--install", "x"], undefined],
  ]);
  expect(vi.mocked(mkdir).mock.calls).toEqual(
    Array(3).fill(["/root/.kore/state/journal", { recursive: true }]),
  );
  expect(vi.mocked(appendFile).mock.calls.map(([path]) => path)).toEqual([
    JOURNAL,
    JOURNAL,
    JOURNAL,
  ]);
});

test("a failed operation journals the failure, with no context it was not given, and rethrows it", async () => {
  const { runner } = fakeRunner(async (command, args) => {
    throw new CommandError(command, args, {
      stdout: "",
      stderr: "boom\nsecond",
      code: 3,
    });
  });
  await expect(
    withJournal(
      { root: ROOT, environment: "local", command: "cluster up" },
      runner,
      async (journaled) => {
        await journaled.run("k3d", ["cluster", "start"]);
      },
    ),
  ).rejects.toThrow("k3d cluster start failed");
  expect(appendedEntries()).toEqual(failedEntries);
});

test("the journaled error is one line of at most 200 characters", async () => {
  const { runner } = fakeRunner();
  await expect(
    withJournal(
      { root: ROOT, environment: "local", command: "x" },
      runner,
      async () => {
        throw new Error(`${"a".repeat(500)}\nsecond line`);
      },
    ),
  ).rejects.toThrow();
  expect(appendedEntries()[1]).toMatchObject({
    kind: "end",
    error: "a".repeat(200),
  });
});

test("process input and env are never journaled, even when they hold a secret", async () => {
  const { runner, run } = fakeRunner();
  const options = {
    input: "hunter2-plaintext",
    env: { API_TOKEN: "env-secret-value" },
  };
  await withJournal(
    { root: ROOT, environment: "local", command: "secrets sync" },
    runner,
    async (journaled) => {
      await journaled.run("sops", ["--decrypt"], options);
    },
  );
  expect(run.mock.calls).toEqual([["sops", ["--decrypt"], options]]);
  expect(appendedEntries()[1]).toEqual(
    journalEntry({
      kind: "exec",
      command: "sops",
      args: ["--decrypt"],
      code: 0,
      ms: 0,
    }),
  );
  expect(JSON.stringify(appendedEntries())).not.toMatch(
    /hunter2-plaintext|env-secret-value|API_TOKEN/,
  );
});

test("a start-entry write failure stops the operation before the runner is called", async () => {
  vi.mocked(mkdir).mockRejectedValue(errno("ENOTDIR"));
  const { runner, run } = fakeRunner();
  const operation = vi.fn(async (journaled: Runner) => {
    await journaled.run("helm", ["list"]);
  });
  await expect(
    withJournal(
      { root: ROOT, environment: "local", command: "local up" },
      runner,
      operation,
    ),
  ).rejects.toThrow(
    "cannot write the operations journal, so local up did not start: ENOTDIR. Check that .kore/state is writable.",
  );
  expect(operation).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
});

test("a write failure after start warns, once per failed entry, and lets the mutation finish", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(appendFile)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error("disk full"));
  const { runner, run } = fakeRunner();
  const result = await withJournal(
    { root: ROOT, environment: "local", command: "local up" },
    runner,
    async (journaled) => {
      await journaled.run("helm", ["list"]);
      return "finished";
    },
  );
  expect(result).toBe("finished");
  expect(run).toHaveBeenCalledOnce();
  expect(warn.mock.calls).toEqual([
    ["warning: could not write the operations journal: disk full"],
    ["warning: could not write the operations journal: disk full"],
  ]);
});

test("an operation with a start and no end is reported as interrupted, and the others keep their outcome", async () => {
  vi.mocked(readFile).mockResolvedValue(
    journalText(operationFixture, "not json"),
  );
  const operations = summarizeOperations(await readJournal(ROOT, "local"));
  expect(operations).toEqual(operationSummaries);
});

test("reading a journal skips torn lines and entries without an op, and keeps the rest", async () => {
  const start = journalEntry({
    kind: "start",
    environment: "local",
    command: "local up",
  });
  vi.mocked(readFile).mockResolvedValue(
    journalText([start], "not json", '{"kind":"start"}'),
  );
  expect(await readJournal(ROOT, "local")).toEqual([start]);
});

test("reading a missing journal yields no entries and writes nothing", async () => {
  expect(await readJournal(ROOT, "local")).toEqual([]);
  expect(vi.mocked(readFile).mock.calls).toEqual([[JOURNAL, "utf8"]]);
  expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
});

test("the runner decorator records a failing command's exit code and rethrows", async () => {
  const { runner } = fakeRunner(async (command, args) => {
    throw new CommandError(command, args, { stdout: "", stderr: "x", code: 7 });
  });
  const journaling = new JournalingRunner(runner, {
    root: ROOT,
    environment: "local",
    op: OP,
  });
  await expect(journaling.run("kubectl", ["get"])).rejects.toThrow(
    CommandError,
  );
  expect(appendedEntries()).toEqual([
    journalEntry({
      kind: "exec",
      command: "kubectl",
      args: ["get"],
      code: 7,
      ms: 0,
    }),
  ]);
});

test("flag values are redacted in both --flag=value and --flag value forms", () => {
  const { args, redacted } = redactionFixtures.flags;
  expect(redactArgs(args)).toEqual(redacted);
});

test("key=value arguments with secret-looking keys are redacted wherever they appear", () => {
  const { args, redacted } = redactionFixtures.keyValues;
  expect(redactArgs(args)).toEqual(redacted);
});

test("an unrelated --set value is kept while a secret in the same list is redacted", () => {
  const { args, redacted } = redactionFixtures.unrelated;
  expect(redactArgs(args)).toEqual(redacted);
});

test("redaction also applies to args journaled by the runner decorator and to failure text", async () => {
  const { runner } = fakeRunner(async (command, args) => {
    throw new CommandError(command, args, {
      stdout: "",
      stderr: "denied",
      code: 1,
    });
  });
  await expect(
    withJournal(
      { root: ROOT, environment: "local", command: "x" },
      runner,
      async (journaled) => {
        await journaled.run("tool", [
          "--token=tok-qwz",
          "--password",
          "pw-jkv",
        ]);
      },
    ),
  ).rejects.toThrow();
  expect(appendedEntries()[1]).toMatchObject({
    args: ["--token=<redacted>", "--password", "<redacted>"],
  });
  expect(appendedEntries()[2]).toMatchObject({
    error: "tool --token=<redacted> --password <redacted> failed (1)",
  });
});

test("non-command error text is redacted before it is journaled", async () => {
  const { runner } = fakeRunner();
  await expect(
    withJournal(
      { root: ROOT, environment: "local", command: "x" },
      runner,
      async () => {
        throw new Error("wrapped: tool --set db.password=hunter2 failed");
      },
    ),
  ).rejects.toThrow();
  expect(appendedEntries()[1]).toMatchObject({
    error: "wrapped: tool --set db.password=<redacted>",
  });
});

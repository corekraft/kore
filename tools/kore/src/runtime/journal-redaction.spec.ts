import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { CommandError, RecordingRunner, type Runner } from "./runner.js";
import { redactArgs, withJournal } from "./journal.js";

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kore-journal-"));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

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

test("key=value arguments with secret-looking keys are redacted wherever they appear", () => {
  expect(
    redactArgs([
      "upgrade",
      "--set",
      "db.password=p1",
      "--set-string",
      "auth.token=t2",
      "--from-literal=password=p3",
      "api_key=k4",
      "--set",
      "replicas=2",
      "--set=image.tag=v1",
    ]),
  ).toEqual([
    "upgrade",
    "--set",
    "db.password=<redacted>",
    "--set-string",
    "auth.token=<redacted>",
    "--from-literal=password=<redacted>",
    "api_key=<redacted>",
    "--set",
    "replicas=2",
    "--set=image.tag=v1",
  ]);
});

test("an unrelated --set value is kept while a secret in the same list is redacted", () => {
  expect(redactArgs(["--set", "replicas=2,db.password=p1"])).toEqual([
    "--set",
    "replicas=2,db.password=<redacted>",
  ]);
});

test("non-command error text is redacted before it is journaled", async () => {
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
  const text = await readFile(
    join(dir, ".kore", "state", "journal", "local.jsonl"),
    "utf8",
  );
  expect(text).not.toContain("hunter2");
  expect(text).toContain("db.password=<redacted>");
});

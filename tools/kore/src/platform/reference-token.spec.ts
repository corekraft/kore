import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { readReferenceApiToken } from "./reference-token.js";

// Docs: docs/decisions/0073-digest-required-admission.md
// The live smoke spec obtains the API token from the cluster Secret, never
// from .kore/. Fast tests fake the runner; no Secret value is ever printed.

const token = "ab".repeat(32);
const encoded = Buffer.from(token).toString("base64");

test("the token is read from the reference Secret with the configured context", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: encoded, stderr: "", code: 0 };
    },
  };

  assert.equal(await readReferenceApiToken(repository, runner), token);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "kubectl");
  assert.deepEqual(calls[0]!.args.slice(0, 4), [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "reference",
  ]);
  assert.ok(calls[0]!.args.includes("secret/reference-app"));
  assert.ok(
    calls[0]!.args.includes("--output=jsonpath={.data.API_TOKEN}"),
    "only the one key is requested, never the whole Secret",
  );
});

test("the helper never touches .kore/ or prints the token", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run(_command, args, options) {
      assert.equal(options?.capture, true, "output must be captured");
      assert.ok(!args.join(" ").includes(".kore"));
      return { stdout: encoded, stderr: "", code: 0 };
    },
  };
  const logged: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => logged.push(parts.join(" "));
  try {
    await readReferenceApiToken(repository, runner);
  } finally {
    console.log = original;
  }
  assert.deepEqual(logged, []);
});

test("a missing Secret names the fix and carries no output", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run() {
      throw new CommandError("kubectl", [], {
        stdout: "",
        stderr:
          'Error from server (NotFound): secrets "reference-app" not found',
        code: 1,
      });
    },
  };
  await assert.rejects(
    readReferenceApiToken(repository, runner),
    /kore app up reference/,
  );
});

test("an empty or malformed token is refused without echoing it", async () => {
  const repository = await loadRepository("local");
  for (const stdout of ["", Buffer.from("not-hex-token").toString("base64")]) {
    const runner: Runner = {
      async run() {
        return { stdout, stderr: "", code: 0 };
      },
    };
    await assert.rejects(readReferenceApiToken(repository, runner), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("not-hex-token"));
      assert.match(error.message, /API_TOKEN/);
      return true;
    });
  }
});

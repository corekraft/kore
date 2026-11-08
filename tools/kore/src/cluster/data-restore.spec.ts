import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { exportRetainedData } from "./export.js";
import { exportDirectory } from "./export-manifest.js";
import { restoreRetainedData } from "./restore.js";
import {
  CIPHERTEXT,
  FakeRunner,
  PLAINTEXT,
  exportOptions,
  useExportRepository,
} from "./data-export.fixtures.js";

const state = useExportRepository();
async function exported(): Promise<{ artifact: string }> {
  const { exports } = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  return { artifact: exports[0]!.artifact };
}

const restoreBase = { overwriteData: false, yes: false };

test("restore verifies the digest, decrypts through age with the user's identity, and loads into the primary", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  const result = await restoreRetainedData(state.repository, runner, {
    ...restoreBase,
    from: artifact,
    identity: "/home/user/key.txt",
    env: {},
  });

  const age = runner.calls.find((c) => c.command === "age");
  assert.ok(age);
  assert.deepEqual(age.args, ["--decrypt", "--identity", "/home/user/key.txt"]);
  assert.equal(age.options?.input, CIPHERTEXT);
  const load = runner.calls.find((c) =>
    c.args.includes("--single-transaction"),
  );
  assert.ok(load);
  assert.deepEqual(load.args.slice(0, 2), ["--context", "kore-local"]);
  assert.equal(load.options?.input, PLAINTEXT);
  assert.ok(load.args.includes("-i"));
  assert.ok(load.args.includes("ON_ERROR_STOP=1"));
  assert.equal(result.restored, true);
  assert.equal(result.cluster, "pg-main");
});

test("restore uses SOPS_AGE_KEY_FILE as the identity when no flag is given", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  await restoreRetainedData(state.repository, runner, {
    ...restoreBase,
    from: artifact,
    env: { SOPS_AGE_KEY_FILE: "/home/user/sops-key.txt" },
  });
  const age = runner.calls.find((c) => c.command === "age");
  assert.deepEqual(age?.args, [
    "--decrypt",
    "--identity",
    "/home/user/sops-key.txt",
  ]);
});

test("restore without an identity explains how to supply one and runs nothing", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      ...restoreBase,
      from: artifact,
      env: {},
    }),
    /--identity.*SOPS_AGE_KEY_FILE/s,
  );
  assert.equal(runner.calls.length, 0);
});

test("restore refuses a tampered artifact before decrypting or touching the cluster", async () => {
  const { artifact } = await exported();
  await writeFile(
    join(exportDirectory(state.repository), artifact),
    "tampered",
  );
  const runner = new FakeRunner();
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      ...restoreBase,
      from: artifact,
      identity: "/k",
      env: {},
    }),
    /does not match its manifest/,
  );
  assert.equal(runner.calls.length, 0);
});

test("restore rejects an artifact name that escapes the export directory", async () => {
  const runner = new FakeRunner();
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      ...restoreBase,
      from: "../../etc/passwd",
      identity: "/k",
      env: {},
    }),
    /file name inside/,
  );
  assert.equal(runner.calls.length, 0);
});

test("restore refuses a non-empty database without --overwrite-data and loads nothing", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  runner.tableCount = "3";
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      ...restoreBase,
      from: artifact,
      identity: "/k",
      env: {},
    }),
    /not empty.*--overwrite-data/s,
  );
  assert.equal(
    runner.calls.some((c) => c.command === "age"),
    false,
  );
  assert.equal(
    runner.calls.some((c) => c.args.includes("--single-transaction")),
    false,
  );
});

test("overwriting a non-empty database needs --yes as well", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  runner.tableCount = "3";
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      ...restoreBase,
      overwriteData: true,
      from: artifact,
      identity: "/k",
      env: {},
    }),
    /--yes/,
  );
  assert.equal(
    runner.calls.some((c) => c.args.includes("--single-transaction")),
    false,
  );
});

test("overwrite replaces the public schema inside the same transaction as the load", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  runner.tableCount = "3";
  await restoreRetainedData(state.repository, runner, {
    from: artifact,
    identity: "/k",
    overwriteData: true,
    yes: true,
    env: {},
  });
  const load = runner.calls.find((c) =>
    c.args.includes("--single-transaction"),
  );
  assert.ok(load);
  assert.ok(
    load.options?.input?.startsWith(
      "DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n",
    ),
  );
  assert.ok(load.options?.input?.endsWith(PLAINTEXT));
});

test("restore into a missing target cluster fails without decrypting", async () => {
  const { artifact } = await exported();
  const runner = new FakeRunner();
  runner.clusters = "";
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      ...restoreBase,
      from: artifact,
      identity: "/k",
      env: {},
    }),
    /pg-main.*not found/s,
  );
  assert.equal(
    runner.calls.some((c) => c.command === "age"),
    false,
  );
});

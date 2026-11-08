import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { clusterDestroy } from "./cluster.js";
import { hasVerifiedExport, retainedResources } from "./retained.js";
import { loadRepository } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/runner.js";

function mockStdout(command: string, args: readonly string[]): string {
  if (command === "minikube" && args[0] === "status") {
    return '{"Host":"Running"}';
  }
  if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
    return "kube-system";
  }
  return "";
}

test("retained data blocks cluster deletion", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    {
      stdout: "postgresqlinstance.platform.kore.dev/reference-db\n",
      stderr: "",
      code: 0,
    },
    { stdout: "", stderr: "", code: 0 },
  ]);
  await assert.rejects(
    clusterDestroy(repository, runner, { yes: true, purgeData: false }),
    /destroy blocked by retained data/,
  );
  assert.equal(
    runner.calls.some((call) => call.args.includes("delete")),
    false,
  );
});

test("purging retained data explicitly deletes retained claims before the profile", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([
    { stdout: "{}", stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    {
      stdout: "postgresqlinstance.platform.kore.dev/reference-db\n",
      stderr: "",
      code: 0,
    },
    { stdout: "persistentvolumeclaim/reference-db-1\n", stderr: "", code: 0 },
  ]);

  await clusterDestroy(repository, runner, { yes: true, purgeData: true });
  const deleteCalls = runner.calls.filter(
    ({ command, args }) => command === "kubectl" && args.includes("delete"),
  );
  assert.equal(deleteCalls.length, 2);
  assert.ok(
    deleteCalls.every(
      ({ args }) =>
        args.includes("--all-namespaces") &&
        args.includes("--ignore-not-found"),
    ),
  );
  assert.equal(runner.calls.at(-1)?.command, "minikube");
  assert.equal(runner.calls.at(-1)?.args[0], "delete");
});

test("purge tolerates a PostgreSQL CRD that was never installed", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner = {
    async run(command: string, args: readonly string[]) {
      calls.push({ command, args });
      if (
        command === "kubectl" &&
        args.includes("delete") &&
        args.includes("postgresqlinstances.platform.kore.dev")
      ) {
        throw new Error(
          'the server doesn\'t have a resource type "postgresqlinstances"',
        );
      }
      return {
        stdout: mockStdout(command, args),
        stderr: "",
        code: 0,
      };
    },
  };

  await clusterDestroy(repository, runner, { yes: true, purgeData: true });

  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("delete") &&
        args.includes("pvc"),
    ),
  );
  assert.equal(calls.at(-1)?.command, "minikube");
  assert.equal(calls.at(-1)?.args[0], "delete");
});

test("verified exports allow destroying an unreachable profile without purging data", async () => {
  const repository = await loadRepository("local");
  const exportDirectory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  await mkdir(exportDirectory, { recursive: true });
  const exportFile = join(exportDirectory, "reference.sql");
  const exportContents = "CREATE TABLE reference (id integer);\n";
  await writeFile(exportFile, exportContents);
  const checksum = join(exportDirectory, "reference.sql.sha256");
  await writeFile(
    checksum,
    `${createHash("sha256").update(exportContents).digest("hex")}  reference.sql\n`,
  );
  const runner = new RecordingRunner();
  try {
    await clusterDestroy(repository, runner, { yes: true, purgeData: false });
  } finally {
    await rm(exportDirectory, { recursive: true, force: true });
  }
  assert.equal(runner.calls.at(-1)?.args[0], "delete");
});

test("retained resource discovery ignores unavailable APIs, trims, deduplicates, and sorts", async () => {
  const repository = await loadRepository("local");
  let query = 0;
  const runner = {
    async run() {
      query += 1;
      if (query === 1) {
        return {
          stdout:
            " postgresqlinstance.platform.kore.dev/reference-db \npostgresqlinstance.platform.kore.dev/reference-db\n",
          stderr: "",
          code: 0,
        };
      }
      throw new CommandError("kubectl", ["get", "pvc"], {
        stdout: "",
        stderr: 'error: the server doesn\'t have a resource type "pvc"',
        code: 1,
      });
    },
  };

  assert.deepEqual(await retainedResources(repository, runner), [
    "postgresqlinstance.platform.kore.dev/reference-db",
  ]);
});

test("a missing PostgreSQL CRD counts as no retained data", async () => {
  const repository = await loadRepository("local");
  let query = 0;
  const runner = {
    async run() {
      query += 1;
      if (query === 1) {
        throw new CommandError("kubectl", ["get"], {
          stdout: "",
          stderr:
            'error: the server doesn\'t have a resource type "postgresqlinstances"',
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  assert.deepEqual(await retainedResources(repository, runner), []);
});

test("an unreachable cluster blocks destroy instead of counting as no retained data", async () => {
  const repository = await loadRepository("local");
  const runner = {
    calls: [] as string[][],
    async run(command: string, args: readonly string[]) {
      this.calls.push([command, ...args]);
      if (command === "kubectl" && args.includes("get")) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr:
            "Unable to connect to the server: dial tcp 192.168.49.2:8443: i/o timeout",
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    retainedResources(repository, runner),
    /Unable to connect/,
  );
  await assert.rejects(
    clusterDestroy(repository, runner, { yes: true, purgeData: false }),
    /Unable to connect/,
  );
  assert.equal(
    runner.calls.some((call) => call.includes("delete")),
    false,
  );
});

test("export verification rejects malformed or mismatched checksum files", async () => {
  const repository = await loadRepository("local");
  const exportDirectory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  await mkdir(exportDirectory, { recursive: true });
  try {
    await writeFile(
      join(exportDirectory, "invalid.sha256"),
      "not a checksum\n",
    );
    await writeFile(
      join(exportDirectory, "missing-name.sha256"),
      `${"a".repeat(64)}\n`,
    );
    await writeFile(
      join(exportDirectory, "missing-name"),
      "different contents",
    );
    assert.equal(await hasVerifiedExport(repository), false);
  } finally {
    await rm(exportDirectory, { recursive: true, force: true });
  }
});

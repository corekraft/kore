import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { clusterDestroy } from "./cluster.js";
import { hasVerifiedExport } from "./export-manifest.js";
import { purgeRetainedResources, retainedResources } from "./retained.js";

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
  const repository = await loadMinikubeLocal();
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
  const repository = await loadMinikubeLocal();
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
  const repository = await loadMinikubeLocal();
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
  const repository = {
    ...(await loadMinikubeLocal()),
    root: await mkdtemp(join(tmpdir(), "kore-retained-")),
  };
  const exportDirectory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  await mkdir(exportDirectory, { recursive: true });
  const artifact = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n";
  await writeFile(join(exportDirectory, "reference.sql.age"), artifact);
  await writeFile(
    join(exportDirectory, "reference.sql.age.manifest.json"),
    JSON.stringify({
      version: 1,
      environment: repository.environment.name,
      createdAt: "2026-11-08T00:00:00.000Z",
      recipient: "age1x",
      contents: {
        kind: "cnpg-database",
        namespace: "reference",
        cluster: "reference-db",
        database: "app",
        format: "pg_dump-plain",
      },
      artifact: {
        file: "reference.sql.age",
        sha256: createHash("sha256").update(artifact).digest("hex"),
        bytes: Buffer.byteLength(artifact),
      },
    }),
  );
  const runner = new RecordingRunner();
  try {
    await clusterDestroy(repository, runner, { yes: true, purgeData: false });
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
  assert.equal(runner.calls.at(-1)?.args[0], "delete");
});

test("retained resource discovery ignores unavailable APIs, trims, deduplicates, and sorts", async () => {
  const repository = await loadMinikubeLocal();
  let query = 0;
  const runner = {
    async run() {
      query += 1;
      if (query === 3) {
        return { stdout: '{"items":[]}', stderr: "", code: 0 };
      }
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
  const repository = await loadMinikubeLocal();
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
  // An isolated root: a real export under the repository's .kore/ would
  // legitimately unblock destroy and hide what this test protects.
  const repository = {
    ...(await loadMinikubeLocal()),
    root: await mkdtemp(join(tmpdir(), "kore-retained-")),
  };
  try {
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
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});

test("export verification rejects malformed or mismatched manifests", async () => {
  const repository = {
    ...(await loadMinikubeLocal()),
    root: await mkdtemp(join(tmpdir(), "kore-retained-")),
  };
  const exportDirectory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  await mkdir(exportDirectory, { recursive: true });
  try {
    await writeFile(
      join(exportDirectory, "invalid.manifest.json"),
      "not json\n",
    );
    await writeFile(
      join(exportDirectory, "empty.manifest.json"),
      JSON.stringify({ version: 1 }),
    );
    assert.equal(await hasVerifiedExport(repository), false);
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});

test("purge never waits on a claim that a running pod still mounts", async () => {
  const repository = await loadMinikubeLocal();
  const runner = new RecordingRunner([]);

  await purgeRetainedResources(repository, runner);

  const pvcDelete = runner.calls.find(
    ({ args }) => args.includes("delete") && args.includes("pvc"),
  );
  assert.ok(pvcDelete, "expected a pvc delete");
  assert.ok(pvcDelete.args.includes("--wait=false"));
  assert.equal(pvcDelete.args.includes("--wait"), false);
});

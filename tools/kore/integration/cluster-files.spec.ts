// Docs: infra/plans/14-test-tiers.md#step-2-pilots
// The cluster domain's flows over real files: a repository's .kore/exports, a real
// host trust directory, and a real manifest read back from disk. Real units run
// together with a fake runner, so no cluster or network is touched (ADR 0098).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  clusterDestroy,
  exportRetainedData,
  hasVerifiedExport,
  restoreRetainedData,
} from "../src/cluster/index.js";
import {
  CIPHERTEXT,
  FakeRunner,
  exportOptions,
  fakeRunner,
  k3dRepository,
  ok,
  testHome,
  text,
  useExportRepository,
} from "../src/testing/index.js";
import type { Runner } from "../src/runtime/index.js";

const state = useExportRepository();

const exportsDirectory = () =>
  join(state.repository.root, ".kore", "exports", "local");

async function exportedFiles(): Promise<string[]> {
  return (await readdir(exportsDirectory())).sort();
}

/** A k3d cluster that reports `running` servers and no retained volumes. */
function clusterRunner(running: number) {
  const { runner: base, calls } = fakeRunner(running);
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "kubectl" && args.includes("persistentvolumes")) {
        calls.push({ command, args });
        return ok('{"items":[]}');
      }
      if (command === "kubectl" && args.includes("-l")) {
        calls.push({ command, args });
        return ok("");
      }
      return base.run(command, args, options);
    },
  };
  return { runner, calls };
}

test("an export's manifest on disk proves its artifact's digest, contents, environment, and recipient", async () => {
  const { exports } = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  const manifest = JSON.parse(
    await readFile(join(exportsDirectory(), exports[0]!.manifest), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(manifest["environment"], "local");
  assert.deepEqual(manifest["contents"], {
    kind: "cnpg-database",
    namespace: "reference",
    cluster: "pg-main",
    database: "app",
    format: "pg_dump-plain",
  });
  assert.deepEqual(manifest["artifact"], {
    file: exports[0]!.artifact,
    sha256: createHash("sha256").update(CIPHERTEXT).digest("hex"),
    bytes: Buffer.byteLength(CIPHERTEXT),
  });
  assert.equal(await hasVerifiedExport(state.repository), true);
});

test("an export is only verified while its artifact still matches the manifest digest", async () => {
  assert.equal(await hasVerifiedExport(state.repository), false);
  const { exports } = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  await writeFile(
    join(exportsDirectory(), exports[0]!.artifact),
    `${CIPHERTEXT}tampered`,
  );
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("a bare checksum file without a manifest is not a verified export", async () => {
  const directory = exportsDirectory();
  await exportRetainedData(state.repository, new FakeRunner(), exportOptions);
  await rm(directory, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "a.sql"), "x");
  await writeFile(
    join(directory, "a.sql.sha256"),
    `${createHash("sha256").update("x").digest("hex")}  a.sql\n`,
  );
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("a manifest recorded for another environment does not verify this one", async () => {
  const { exports } = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  const path = join(exportsDirectory(), exports[0]!.manifest);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.environment = "staging";
  await writeFile(path, JSON.stringify(manifest));
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("a malformed or mismatched manifest on disk never verifies", async () => {
  const directory = exportsDirectory();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "invalid.manifest.json"), "not json\n");
  await writeFile(
    join(directory, "empty.manifest.json"),
    JSON.stringify({ version: 1 }),
  );
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("export never leaves plaintext on disk, only ciphertext and a manifest", async () => {
  await exportRetainedData(state.repository, new FakeRunner(), exportOptions);
  const names = await exportedFiles();
  assert.ok(names.length >= 2);
  for (const name of names) {
    const text = await readFile(join(exportsDirectory(), name), "utf8");
    assert.equal(text.includes("PLAINTEXT-MARKER"), false, name);
    assert.equal(text.includes("CREATE TABLE"), false, name);
  }
});

test("a failed encryption leaves no artifact or manifest behind on disk", async () => {
  const runner = new FakeRunner();
  runner.failAge = true;
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /age: boom/,
  );
  assert.equal(await hasVerifiedExport(state.repository), false);
  const names = await readdir(exportsDirectory()).catch(() => []);
  assert.deepEqual(names, []);
});

test("restore refuses a tampered artifact before decrypting or touching the cluster", async () => {
  const { exports } = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  await writeFile(join(exportsDirectory(), exports[0]!.artifact), "tampered");
  const runner = new FakeRunner();
  await assert.rejects(
    restoreRetainedData(state.repository, runner, {
      from: exports[0]!.artifact,
      identity: "/k",
      overwriteData: false,
      yes: false,
      env: {},
    }),
    /does not match its manifest/,
  );
  assert.equal(runner.calls.length, 0);
});

test("a verified export on disk lets an unreachable profile be destroyed without purging data", async () => {
  await exportRetainedData(state.repository, new FakeRunner(), exportOptions);
  const { runner, calls } = clusterRunner(0);
  await clusterDestroy(
    { ...(await k3dRepository()), root: state.repository.root },
    runner,
    { yes: true, purgeData: false },
    testHome,
  );
  assert.ok(text(calls).includes("k3d cluster delete kore-local"));
});

test("destroy removes only this cluster's host trust directory under the home", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-destroy-home-"));
  const mine = join(home, ".kore", "k3d", "kore-local", "registry-trust");
  const other = join(home, ".kore", "k3d", "other-cluster");
  mkdirSync(mine, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(join(mine, "ca.crt"), "public");
  try {
    const { runner } = clusterRunner(1);
    await clusterDestroy(
      await k3dRepository(),
      runner,
      { yes: true, purgeData: false },
      home,
    );
    assert.equal(existsSync(join(home, ".kore", "k3d", "kore-local")), false);
    assert.equal(existsSync(other), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a refused destroy leaves the host trust directory in place", async () => {
  const home = mkdtempSync(join(tmpdir(), "kore-k3d-destroy-home-"));
  const mine = join(home, ".kore", "k3d", "kore-local", "registry-trust");
  mkdirSync(mine, { recursive: true });
  try {
    const { runner } = clusterRunner(1);
    await assert.rejects(
      clusterDestroy(
        await k3dRepository(),
        runner,
        { yes: false, purgeData: false },
        home,
      ),
      /requires --yes/,
    );
    assert.equal(existsSync(mine), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

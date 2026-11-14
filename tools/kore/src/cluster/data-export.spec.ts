import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { exportRetainedData } from "./export.js";
import { exportDirectory, hasVerifiedExport } from "./export-manifest.js";
import {
  CIPHERTEXT,
  FakeRunner,
  NOW,
  PLAINTEXT,
  RECIPIENT,
  exportOptions,
  useExportRepository,
} from "../testing/index.js";

const state = useExportRepository();

async function exportedFiles(): Promise<string[]> {
  return (await readdir(exportDirectory(state.repository))).sort();
}

test("export streams pg_dump from the CNPG primary into age and names the configured context", async () => {
  const runner = new FakeRunner();
  const result = await exportRetainedData(
    state.repository,
    runner,
    exportOptions,
  );

  const kubectl = runner.calls.filter((c) => c.command === "kubectl");
  assert.ok(kubectl.length > 0);
  for (const call of kubectl) {
    assert.deepEqual(call.args.slice(0, 2), ["--context", "k3d-kore-local"]);
  }
  const dump = runner.calls.find((c) => c.args.includes("pg_dump"));
  assert.ok(dump);
  assert.ok(dump.args.includes("pg-main-1"));
  assert.ok(dump.args.includes("--namespace"));
  assert.ok(dump.args.includes("reference"));
  assert.ok(dump.args.includes("--dbname=app"));
  const age = runner.calls.find((c) => c.command === "age");
  assert.ok(age);
  assert.deepEqual(age.args, ["--armor", "--recipient", RECIPIENT]);
  assert.equal(age.options?.input, PLAINTEXT);
  assert.equal(result.exports.length, 1);
});

test("export refuses the placeholder recipient before touching the cluster", async () => {
  await writeFile(
    join(state.root, ".sops.yaml"),
    "creation_rules:\n  - path_regex: infra/environments/local/secrets/.*\\.enc\\.yaml$\n    age: AGE-RECIPIENT-MUST-BE-CONFIGURED\n",
  );
  const runner = new FakeRunner();
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /age recipient.*\.sops\.yaml/s,
  );
  assert.equal(runner.calls.length, 0);
});

test("export refuses a malformed recipient and a missing rule", async () => {
  const runner = new FakeRunner();
  await writeFile(
    join(state.root, ".sops.yaml"),
    "creation_rules:\n  - path_regex: infra/environments/local/secrets/.*\n    age: not-an-age-key\n",
  );
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /not a valid age recipient/,
  );
  await writeFile(join(state.root, ".sops.yaml"), "creation_rules: []\n");
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /no creation rule/,
  );
  assert.equal(runner.calls.length, 0);
});

test("export never writes plaintext to disk", async () => {
  await exportRetainedData(state.repository, new FakeRunner(), exportOptions);
  const names = await exportedFiles();
  assert.ok(names.length >= 2);
  for (const name of names) {
    const text = await readFile(
      join(exportDirectory(state.repository), name),
      "utf8",
    );
    assert.equal(text.includes("PLAINTEXT-MARKER"), false, name);
    assert.equal(text.includes("CREATE TABLE"), false, name);
  }
});

test("export records a manifest that proves the artifact digest, contents, environment, and time", async () => {
  const result = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  const entry = result.exports[0]!;
  const manifest = JSON.parse(
    await readFile(
      join(exportDirectory(state.repository), entry.manifest),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(manifest["environment"], "local");
  assert.equal(manifest["createdAt"], NOW.toISOString());
  assert.deepEqual(manifest["contents"], {
    kind: "cnpg-database",
    namespace: "reference",
    cluster: "pg-main",
    database: "app",
    format: "pg_dump-plain",
  });
  assert.equal(manifest["recipient"], RECIPIENT);
  assert.deepEqual(manifest["artifact"], {
    file: entry.artifact,
    sha256: createHash("sha256").update(CIPHERTEXT).digest("hex"),
    bytes: Buffer.byteLength(CIPHERTEXT),
  });
  assert.equal(await hasVerifiedExport(state.repository), true);
});

test("an export is only verified while its artifact matches the manifest digest", async () => {
  assert.equal(await hasVerifiedExport(state.repository), false);
  const { exports } = await exportRetainedData(
    state.repository,
    new FakeRunner(),
    exportOptions,
  );
  const artifact = join(
    exportDirectory(state.repository),
    exports[0]!.artifact,
  );
  await writeFile(artifact, `${CIPHERTEXT}tampered`);
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("a bare checksum file without a manifest is not a verified export", async () => {
  const directory = exportDirectory(state.repository);
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
  const path = join(exportDirectory(state.repository), exports[0]!.manifest);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.environment = "staging";
  await writeFile(path, JSON.stringify(manifest));
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("export fails closed when retained volumes exist that the logical dump does not cover", async () => {
  const runner = new FakeRunner();
  runner.uncovered = "persistentvolumeclaim/scratch\n";
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /persistentvolumeclaim\/scratch/,
  );
  assert.equal(
    runner.calls.some((c) => c.args.includes("pg_dump")),
    false,
  );
  assert.equal(await hasVerifiedExport(state.repository), false);
});

test("export fails when no retained database exists", async () => {
  const runner = new FakeRunner();
  runner.clusters = "";
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /no retained CloudNativePG cluster/,
  );
});

test("a failed encryption leaves no artifact or manifest behind", async () => {
  const runner = new FakeRunner();
  runner.failAge = true;
  await assert.rejects(
    exportRetainedData(state.repository, runner, exportOptions),
    /age: boom/,
  );
  assert.equal(await hasVerifiedExport(state.repository), false);
  const names = await readdir(exportDirectory(state.repository)).catch(
    () => [],
  );
  assert.deepEqual(names, []);
});

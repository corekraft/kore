import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "vitest";
import { findRoot } from "../config/config.js";
import { loadRepository, type Repository } from "../config/index.js";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";
import { opsReport } from "./report.js";
import { XRD, snapshotFiles, type Snapshot } from "./upgrade.fixtures.js";

const previous: Snapshot = {
  kubernetes: "1.36.0",
  components: { demo: "1.0.0" },
};
const current: Snapshot = { ...previous, components: { demo: "1.1.0" } };

const crd = (version: string) => ({
  metadata: { name: "w.example.dev" },
  spec: {
    group: "example.dev",
    versions: [{ name: version, served: true, storage: true }],
  },
});

/** git show serves the previous snapshot; helm and yq return the CRD for the rendered version. */
class Runner_ implements Runner {
  calls: string[] = [];
  constructor(private readonly crdFor: (version: string) => unknown) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push(`${command} ${args.join(" ")}`);
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    if (command === "git" && args[0] === "tag") {
      return ok("v0.4.0\n");
    }
    if (command === "git") {
      const path = String(args[1]).split(":")[1]!;
      return ok(snapshotFiles(previous)[path] ?? "");
    }
    if (command === "helm") {
      return ok(`version=${args[args.indexOf("--version") + 1]}`);
    }
    return ok(
      options?.input?.startsWith("version=")
        ? `${JSON.stringify(this.crdFor(options.input.slice(8)))}\n`
        : (options?.input ?? ""),
    );
  }
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});

async function fixtureRepository(): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-report-"));
  roots.push(root);
  for (const [path, content] of Object.entries(snapshotFiles(current))) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return {
    root,
    versions: { components: { demo: "1.1.0" } },
    catalog: {
      components: [
        {
          name: "demo",
          kind: "helm",
          namespace: "demo",
          repository: "https://c",
          chart: "demo",
          version: "demo",
        },
      ],
    },
  } as unknown as Repository;
}

test("inventory reports counts and passes on this repository", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local", root);
  const { report, ok } = await opsReport("inventory", {
    repository,
    runner: new Runner_(crd),
    json: false,
  });
  assert.equal(ok, true);
  const counts = (report as { counts: Record<string, number> }).counts;
  assert.ok(counts["component"]! > 0 && counts["npm"]! > 0);
  assert.equal("items" in (report as object), false);
});

test("inventory --json carries every item for review", async () => {
  const repository = await loadRepository("local", await findRoot());
  const { report } = await opsReport("inventory", {
    repository,
    runner: new Runner_(crd),
    json: true,
  });
  assert.ok((report as { items: unknown[] }).items.length > 100);
});

test("recovery passes on this repository and names the stateful components", async () => {
  const repository = await loadRepository("local", await findRoot());
  const { report, ok } = await opsReport("recovery", {
    repository,
    runner: new Runner_(crd),
    json: false,
  });
  assert.equal(ok, true);
  assert.ok(
    (report as { stateful: string[] }).stateful.includes("oci-registry"),
  );
});

test("upgrade-check defaults to the newest release tag and reports version changes", async () => {
  const repository = await fixtureRepository();
  const { report, ok } = await opsReport("upgrade-check", {
    repository,
    runner: new Runner_(crd),
    json: false,
  });
  assert.equal(ok, true);
  assert.equal((report as { from: string }).from, "v0.4.0");
  assert.deepEqual((report as { changes: unknown[] }).changes, [
    { name: "demo", from: "1.0.0", to: "1.1.0" },
  ]);
});

test("upgrade-check fails when the application contract breaks", async () => {
  const repository = await fixtureRepository();
  await writeFile(
    join(
      repository.root,
      "infra/apis/postgresql/definitions/postgresqlinstance.yaml",
    ),
    JSON.stringify(XRD({}, ["size", "tier"])),
  );
  const { ok, report } = await opsReport("upgrade-check", {
    repository,
    runner: new Runner_(crd),
    json: false,
    from: "v0.4.0",
  });
  assert.equal(ok, false);
  assert.match(
    (report as { problems: string[] }).problems.join(),
    /became required/,
  );
});

test("crd-check renders changed charts at both versions and fails an unsafe storage move", async () => {
  const repository = await fixtureRepository();
  const runner = new Runner_((version) =>
    version === "1.0.0" ? crd("v1") : crd("v2"),
  );
  const { report, ok } = await opsReport("crd-check", {
    repository,
    runner,
    json: false,
  });
  assert.equal(ok, false);
  assert.deepEqual((report as { checked: string[] }).checked, ["demo"]);
  assert.match(
    (report as { problems: string[] }).problems.join("\n"),
    /demo 1\.0\.0 -> 1\.1\.0: w\.example\.dev: stored version v1 is no longer defined/,
  );
  assert.ok(
    runner.calls.every((c) => /^(git|helm template|yq)/.test(c)),
    "read-only commands only",
  );
});

test("crd-check passes when both versions ship the same CRDs", async () => {
  const repository = await fixtureRepository();
  const { ok } = await opsReport("crd-check", {
    repository,
    runner: new Runner_(() => crd("v1")),
    json: false,
  });
  assert.equal(ok, true);
});

test("an unknown action is rejected with the supported list", async () => {
  const repository = await loadRepository("local", await findRoot());
  await assert.rejects(
    opsReport("nope", { repository, runner: new Runner_(crd), json: false }),
    /unknown ops action nope; use inventory, recovery, upgrade-check, or crd-check/,
  );
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "vitest";
import type { Repository } from "../../src/config/index.js";
import type { Runner, RunOptions, RunResult } from "../../src/runtime/index.js";
import { opsReport } from "../../src/ops/index.js";

// Real files and real units together: the upgrade and CRD checks read a
// temporary repository and a fake CLI through the ops barrel. Unit tests of
// each file live beside it in src/ops.

interface Snapshot {
  kubernetes: string;
  components: Record<string, string>;
  owns?: Record<string, string[]>;
  xrd?: unknown;
}

const XRD = (
  extraProps: Record<string, unknown> = {},
  required = ["size"],
) => ({
  spec: {
    versions: [
      {
        name: "v1alpha1",
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                required,
                properties: { size: { type: "string" }, ...extraProps },
              },
            },
          },
        },
      },
    ],
  },
});

/** The three repository files an upgrade check reads, as JSON text. */
function snapshotFiles(snapshot: Snapshot): Record<string, string> {
  const names = Object.keys(snapshot.components);
  return {
    "infra/catalog/versions.yaml": JSON.stringify({
      kubernetes: snapshot.kubernetes,
      components: snapshot.components,
    }),
    "infra/catalog/components.yaml": JSON.stringify({
      components: names.map((name) => ({
        name,
        version: name,
        ownsCRDs: snapshot.owns?.[name] ?? [],
      })),
    }),
    "infra/apis/postgresql/definitions/postgresqlinstance.yaml": JSON.stringify(
      snapshot.xrd ?? XRD(),
    ),
  };
}

const crd = (version: string) => ({
  metadata: { name: "w.example.dev" },
  spec: {
    group: "example.dev",
    versions: [{ name: version, served: true, storage: true }],
  },
});

/**
 * A fake CLI: `git show` serves the snapshot at each release tag, `git tag`
 * lists the tags, `helm template` echoes its version and `yq` renders the CRD
 * the test chooses for that version (JSON passes through unchanged).
 */
class FakeCli implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  constructor(
    private readonly refs: Record<string, Record<string, string>>,
    private readonly crdFor: (version: string) => unknown = () => crd("v1"),
    private readonly tags: string[] = ["v0.4.0"],
  ) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    if (command === "git" && args[0] === "tag") {
      return ok(this.tags.join("\n"));
    }
    if (command === "git" && args[0] === "show") {
      const [ref, path] = String(args[1]).split(":") as [string, string];
      const content = this.refs[ref]?.[path];
      if (content === undefined) {
        throw new Error(`fatal: path '${path}' does not exist in '${ref}'`);
      }
      return ok(content);
    }
    if (command === "helm") {
      return ok(`version=${args[args.indexOf("--version") + 1]}`);
    }
    if (command === "yq") {
      const input = options?.input ?? "";
      return ok(
        input.startsWith("version=")
          ? `${JSON.stringify(this.crdFor(input.slice(8)))}\n`
          : input,
      );
    }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  }
}

const previous: Snapshot = {
  kubernetes: "1.36.0",
  components: { crossplane: "2.4.0", istio: "1.31.0" },
  owns: { crossplane: ["a.crossplane.io"] },
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workingTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-upgrade-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function upgradeCheck(
  next: Snapshot,
  from = "v0.4.0",
  runner = new FakeCli({ [from]: snapshotFiles(previous) }),
) {
  const root = await workingTree(snapshotFiles(next));
  const { report, ok } = await opsReport("upgrade-check", {
    repository: { root } as unknown as Repository,
    runner,
    json: false,
    from,
  });
  return { report, ok, runner };
}

const problemsOf = (report: Record<string, unknown>): string[] =>
  report["problems"] as string[];

test("a forward upgrade passes and lists each version change", async () => {
  const { report, ok } = await upgradeCheck({
    ...previous,
    kubernetes: "1.37.2",
    components: { crossplane: "2.4.3", istio: "1.31.0", gatekeeper: "3.23.1" },
    owns: { crossplane: ["a.crossplane.io"] },
  });
  assert.equal(ok, true);
  assert.deepEqual(problemsOf(report), []);
  assert.deepEqual(report["changes"], [
    { name: "crossplane", from: "2.4.0", to: "2.4.3" },
    { name: "gatekeeper", from: undefined, to: "3.23.1" },
    { name: "kubernetes", from: "1.36.0", to: "1.37.2" },
  ]);
});

test("the previous catalog is read from the release tag, never the working tree", async () => {
  const { runner } = await upgradeCheck(previous);
  const shown = runner.calls.filter((c) => c.command === "git");
  assert.ok(shown.length > 0);
  assert.ok(
    shown.every(
      (c) => c.args[0] === "show" && String(c.args[1]).startsWith("v0.4.0:"),
    ),
  );
});

test("a component downgrade is reported", async () => {
  const { report } = await upgradeCheck({
    ...previous,
    components: { crossplane: "2.3.9", istio: "1.31.0" },
  });
  assert.match(
    problemsOf(report).join("\n"),
    /crossplane: 2\.3\.9 is older than the supported 2\.4\.0/,
  );
});

test("skipping a Kubernetes minor version is reported", async () => {
  const { report } = await upgradeCheck({ ...previous, kubernetes: "1.38.0" });
  assert.match(
    problemsOf(report).join("\n"),
    /kubernetes: 1\.36\.0 to 1\.38\.0 skips a minor version/,
  );
});

test("removing a component that owns CRDs is reported", async () => {
  const { report } = await upgradeCheck({
    ...previous,
    components: { istio: "1.31.0" },
    owns: {},
  });
  assert.match(
    problemsOf(report).join("\n"),
    /crossplane: removed while it owns CRDs a\.crossplane\.io/,
  );
});

test("dropping an owned CRD from a kept component is reported", async () => {
  const { report } = await upgradeCheck({
    ...previous,
    owns: { crossplane: [] },
  });
  assert.match(
    problemsOf(report).join("\n"),
    /crossplane: no longer owns CRD a\.crossplane\.io/,
  );
});

test("an application contract change that breaks existing claims is reported", async () => {
  const { report } = await upgradeCheck({
    ...previous,
    xrd: XRD({}, ["size", "tier"]),
  });
  assert.match(
    problemsOf(report).join("\n"),
    /application contract postgresqlinstance v1alpha1: spec: field tier became required/,
  );
});

test("an additive application contract change passes", async () => {
  const { report, ok } = await upgradeCheck({
    ...previous,
    xrd: XRD({ tier: { type: "string" } }),
  });
  assert.equal(ok, true);
  assert.deepEqual(problemsOf(report), []);
});

test("removing a served contract version is reported", async () => {
  const { report } = await upgradeCheck({
    ...previous,
    xrd: {
      spec: {
        versions: [{ name: "v1beta1", schema: XRD().spec.versions[0]!.schema }],
      },
    },
  });
  assert.match(problemsOf(report).join("\n"), /version v1alpha1 was removed/);
});

test("a missing release tag fails with the fix", async () => {
  await assert.rejects(
    upgradeCheck(previous, "v9.9.9", new FakeCli({})),
    /cannot read infra\/catalog\/versions\.yaml at v9\.9\.9.*git fetch --tags/s,
  );
});

test("the previous release is the newest v-tag", async () => {
  const root = await workingTree(snapshotFiles(previous));
  const runner = new FakeCli(
    { "v0.4.0": snapshotFiles(previous) },
    () => crd("v1"),
    ["v0.4.0", "v0.3.2"],
  );
  const { report } = await opsReport("upgrade-check", {
    repository: { root } as unknown as Repository,
    runner,
    json: false,
  });
  assert.equal(report["from"], "v0.4.0");
});

test("with no release tag, the upgrade check fails and names the fix", async () => {
  const root = await workingTree(snapshotFiles(previous));
  await assert.rejects(
    opsReport("upgrade-check", {
      repository: { root } as unknown as Repository,
      runner: new FakeCli({}, () => crd("v1"), []),
      json: false,
    }),
    /no release tag found/,
  );
});

test("crd-check renders changed charts at both versions and fails an unsafe storage move", async () => {
  const next: Snapshot = {
    ...previous,
    components: { crossplane: "2.4.3", istio: "1.31.0" },
  };
  const root = await workingTree(snapshotFiles(next));
  const runner = new FakeCli(
    { "v0.4.0": snapshotFiles(previous) },
    (version) => (version === "2.4.0" ? crd("v1") : crd("v2")),
  );
  const { report, ok } = await opsReport("crd-check", {
    repository: {
      root,
      versions: { components: { crossplane: "2.4.3" } },
      catalog: {
        components: [
          {
            name: "crossplane",
            kind: "helm",
            namespace: "crossplane-system",
            repository: "https://c",
            chart: "crossplane",
            version: "crossplane",
          },
        ],
      },
    } as unknown as Repository,
    runner,
    json: false,
  });
  assert.equal(ok, false);
  assert.deepEqual(report["checked"], ["crossplane"]);
  assert.match(
    problemsOf(report).join("\n"),
    /crossplane 2\.4\.0 -> 2\.4\.3: w\.example\.dev: stored version v1 is no longer defined/,
  );
  assert.ok(
    runner.calls.every((c) => /^(git|helm|yq)$/.test(c.command)),
    "read-only commands only",
  );
});

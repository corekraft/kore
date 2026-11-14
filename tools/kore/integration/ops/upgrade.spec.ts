import assert from "node:assert/strict";
import { test } from "vitest";
import type { Repository } from "../../src/config/index.js";
import { opsReport } from "../../src/ops/index.js";
import {
  FakeCli,
  XRD,
  crd,
  previous,
  snapshotFiles,
  useWorkingTrees,
  type Snapshot,
} from "./ops-support.js";

// Real files and real units together: the upgrade check reads a temporary
// repository and a fake CLI through the ops barrel. Unit tests of upgrade.ts
// live beside it in src/ops.

const trees = useWorkingTrees();

async function upgradeCheck(
  next: Snapshot,
  from = "v0.4.0",
  runner = new FakeCli({ [from]: snapshotFiles(previous) }),
) {
  const root = await trees.write(snapshotFiles(next));
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
  const root = await trees.write(snapshotFiles(previous));
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
  const root = await trees.write(snapshotFiles(previous));
  await assert.rejects(
    opsReport("upgrade-check", {
      repository: { root } as unknown as Repository,
      runner: new FakeCli({}, () => crd("v1"), []),
      json: false,
    }),
    /no release tag found/,
  );
});

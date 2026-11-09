import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "vitest";
import {
  GitFakeRunner,
  XRD,
  snapshotFiles,
  type Snapshot,
} from "./upgrade.fixtures.js";
import { previousRelease, upgradeCheck, upgradeProblems } from "./upgrade.js";

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

async function workingTree(snapshot: Snapshot): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-upgrade-"));
  roots.push(root);
  for (const [path, content] of Object.entries(snapshotFiles(snapshot))) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function check(next: Snapshot, from = "v0.4.0") {
  const root = await workingTree(next);
  const runner = new GitFakeRunner({ [from]: snapshotFiles(previous) });
  return { runner, result: await upgradeCheck(runner, root, from) };
}

test("a forward upgrade passes and lists each version change", async () => {
  const { result } = await check({
    ...previous,
    kubernetes: "1.37.2",
    components: { crossplane: "2.4.3", istio: "1.31.0", gatekeeper: "3.23.1" },
    owns: { crossplane: ["a.crossplane.io"] },
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.changes, [
    { name: "crossplane", from: "2.4.0", to: "2.4.3" },
    { name: "gatekeeper", from: undefined, to: "3.23.1" },
    { name: "kubernetes", from: "1.36.0", to: "1.37.2" },
  ]);
});

test("the previous catalog is read from the release tag, never the working tree", async () => {
  const { runner } = await check(previous);
  const shown = runner.calls.filter((c) => c.command === "git");
  assert.ok(shown.length > 0);
  assert.ok(
    shown.every(
      (c) => c.args[0] === "show" && String(c.args[1]).startsWith("v0.4.0:"),
    ),
  );
});

test("a component downgrade is reported", () => {
  const found = upgradeProblems(previous, {
    ...previous,
    components: { crossplane: "2.3.9", istio: "1.31.0" },
  }).join("\n");
  assert.match(
    found,
    /crossplane: 2\.3\.9 is older than the supported 2\.4\.0/,
  );
});

test("skipping a Kubernetes minor version is reported", () => {
  const found = upgradeProblems(previous, {
    ...previous,
    kubernetes: "1.38.0",
  });
  assert.match(
    found.join("\n"),
    /kubernetes: 1\.36\.0 to 1\.38\.0 skips a minor version/,
  );
});

test("removing a component that owns CRDs is reported", () => {
  const found = upgradeProblems(previous, {
    ...previous,
    components: { istio: "1.31.0" },
    owns: {},
  });
  assert.match(
    found.join("\n"),
    /crossplane: removed while it owns CRDs a\.crossplane\.io/,
  );
});

test("dropping an owned CRD from a kept component is reported", () => {
  const found = upgradeProblems(previous, {
    ...previous,
    owns: { crossplane: [] },
  });
  assert.match(
    found.join("\n"),
    /crossplane: no longer owns CRD a\.crossplane\.io/,
  );
});

test("an application contract change that breaks existing claims is reported", async () => {
  const { result } = await check({
    ...previous,
    xrd: XRD({}, ["size", "tier"]),
  });
  assert.match(
    result.problems.join("\n"),
    /application contract postgresqlinstance v1alpha1: spec: field tier became required/,
  );
});

test("an additive application contract change passes", async () => {
  const { result } = await check({
    ...previous,
    xrd: XRD({ tier: { type: "string" } }),
  });
  assert.deepEqual(result.problems, []);
});

test("removing a served contract version is reported", async () => {
  const { result } = await check({
    ...previous,
    xrd: {
      spec: {
        versions: [{ name: "v1beta1", schema: XRD().spec.versions[0]!.schema }],
      },
    },
  });
  assert.match(result.problems.join("\n"), /version v1alpha1 was removed/);
});

test("a missing release tag fails with the fix", async () => {
  const root = await workingTree(previous);
  await assert.rejects(
    upgradeCheck(new GitFakeRunner({}), root, "v9.9.9"),
    /cannot read infra\/catalog\/versions\.yaml at v9\.9\.9.*git fetch --tags/s,
  );
});

test("the previous release is the newest v-tag", async () => {
  const runner = new GitFakeRunner({}, ["v0.4.0", "v0.3.2"]);
  assert.equal(await previousRelease(runner, "/repo"), "v0.4.0");
  await assert.rejects(
    previousRelease(new GitFakeRunner({}, []), "/repo"),
    /no release tag/,
  );
});

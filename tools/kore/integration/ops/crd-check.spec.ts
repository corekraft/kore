import assert from "node:assert/strict";
import { test } from "vitest";
import type { Repository } from "../../src/config/index.js";
import { opsReport } from "../../src/ops/index.js";
import {
  FakeCli,
  crd,
  previous,
  snapshotFiles,
  useWorkingTrees,
  type Snapshot,
} from "./ops-support.js";

// Real files and real units together: the CRD check renders the changed chart
// through a fake CLI and reads the working tree through the ops barrel. Unit
// tests of crd-render.ts and crd-compat.ts live beside them in src/ops.

const trees = useWorkingTrees();

test("crd-check renders changed charts at both versions and fails an unsafe storage move", async () => {
  const next: Snapshot = {
    ...previous,
    components: { crossplane: "2.4.3", istio: "1.31.0" },
  };
  const root = await trees.write(snapshotFiles(next));
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
    (report["problems"] as string[]).join("\n"),
    /crossplane 2\.4\.0 -> 2\.4\.3: w\.example\.dev: stored version v1 is no longer defined/,
  );
  assert.ok(
    runner.calls.every((c) => /^(git|helm|yq)$/.test(c.command)),
    "read-only commands only",
  );
});

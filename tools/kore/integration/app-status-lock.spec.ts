// Docs: docs/decisions/0015-local-signed-image-delivery.md
// Real files, real units: app status reads the committed image lock, and the
// local source-build lock when one exists. The unit spec (app/app.spec.ts)
// covers the status fields with the lock mocked.
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadRepository } from "../src/config/index.js";
import { appStatus } from "../src/app/index.js";
import type { Runner } from "../src/runtime/index.js";
import { list } from "../src/testing/index.js";

/** Helm and kubectl answer healthy and the cluster is the local k3d one. */
const healthy: Runner = {
  async run(command) {
    if (command === "k3d") {
      return { stdout: list(1), stderr: "", code: 0 };
    }
    if (command === "helm") {
      return { stdout: '{"info":{"status":"deployed"}}', stderr: "", code: 0 };
    }
    return { stdout: "kube-system", stderr: "", code: 0 };
  },
};

test("app status reports the committed release lock's image, its digest and its signer", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-lock-"));
  try {
    await mkdir(join(root, "infra/catalog"), { recursive: true });
    await copyFile(
      join(base.root, "infra/catalog/images.lock.json"),
      join(root, "infra/catalog/images.lock.json"),
    );
    const status = await appStatus({ ...base, root }, healthy, "reference");
    expect(status.image).toEqual({
      reference:
        "registry.kore.local:30500/reference@sha256:76eae6c0774b5292f70e3541e57bd8f2b4df2e5f74aacaba258fed9fa894b3bc",
      digest:
        "sha256:76eae6c0774b5292f70e3541e57bd8f2b4df2e5f74aacaba258fed9fa894b3bc",
      signer: "local-kore-key",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app status prefers the local source-build lock over the release lock when one has been recorded", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-local-lock-"));
  try {
    await mkdir(join(root, ".kore/state/environments/local"), {
      recursive: true,
    });
    await copyFile(
      join(base.root, "infra/catalog/images.lock.json"),
      join(root, ".kore/state/environments/local/local-images.lock.json"),
    );
    const status = await appStatus({ ...base, root }, healthy, "reference");
    expect(status.image).toMatchObject({ signer: "local-kore-key" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

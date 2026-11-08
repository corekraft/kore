import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRepository } from "../config/index.js";

async function documents(path: string): Promise<string[]> {
  const repository = await loadRepository("local");
  const text = await readFile(join(repository.root, path), "utf8");
  return text.split(/^---$/m).filter((doc) => doc.trim());
}

function storageClass(docs: string[], name: string): string {
  const doc = docs.find(
    (candidate) =>
      /^kind: StorageClass$/m.test(candidate) &&
      new RegExp(`^  name: ${name}$`, "m").test(candidate),
  );
  if (!doc) {
    throw new Error(`StorageClass ${name} is not defined`);
  }
  return doc;
}

test("kore-standard deletes volumes with their claims and allows expansion", async () => {
  const docs = await documents(
    "infra/charts/platform-storage/templates/storage.yaml",
  );
  const doc = storageClass(docs, "kore-standard");

  expect(doc).toMatch(/^reclaimPolicy: Delete$/m);
  expect(doc).toMatch(/^allowVolumeExpansion: true$/m);
});

test("kore-retained keeps volumes after claim deletion and allows expansion", async () => {
  const docs = await documents(
    "infra/charts/platform-storage/templates/storage.yaml",
  );
  const doc = storageClass(docs, "kore-retained");

  expect(doc).toMatch(/^reclaimPolicy: Retain$/m);
  expect(doc).not.toMatch(/^reclaimPolicy: Delete$/m);
  expect(doc).toMatch(/^allowVolumeExpansion: true$/m);
});

test("the oci-registry claim on kore-retained carries the retention label so destroy and audit see it", async () => {
  const docs = await documents("infra/charts/oci-registry/templates/all.yaml");
  const claim = docs.find((doc) => /^kind: PersistentVolumeClaim$/m.test(doc));

  expect(claim).toBeDefined();
  expect(claim).toMatch(/^  storageClassName: kore-retained$/m);
  expect(claim).toMatch(/platform\.kore\.dev\/retention: Retain/);
});

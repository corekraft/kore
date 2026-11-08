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

test("the oci-registry claim is disposable cache on kore-standard and never counts as retained data", async () => {
  const docs = await documents("infra/charts/oci-registry/templates/all.yaml");
  const claim = docs.find((doc) => /^kind: PersistentVolumeClaim$/m.test(doc));

  expect(claim).toBeDefined();
  expect(claim).toMatch(/^  storageClassName: kore-standard$/m);
  expect(claim).toMatch(/platform\.kore\.dev\/retention: Delete/);
  expect(claim).not.toMatch(/kore-retained/);
  expect(claim).not.toMatch(/retention: Retain/);
});

async function readText(path: string): Promise<string> {
  const repository = await loadRepository("local");
  return readFile(join(repository.root, path), "utf8");
}

/** Flow-style values with whitespace and quotes removed, for formatter-proof matching. */
async function compact(path: string): Promise<string> {
  return (await readText(path)).replace(/[\s"]/g, "");
}

test("observability claims are disposable telemetry labelled Delete on kore-standard", async () => {
  const label = "{platform.kore.dev/retention:Delete}";
  const grafana = await compact("infra/environments/local/values/grafana.yaml");
  expect(grafana).toContain(`extraPvcLabels:${label}`);
  expect(grafana).toContain("storageClassName:kore-standard");
  const prometheus = JSON.parse(
    await readText("infra/environments/local/values/prometheus.yaml"),
  );
  expect(prometheus.server.persistentVolume.labels).toEqual({
    "platform.kore.dev/retention": "Delete",
  });
  expect(prometheus.server.persistentVolume.storageClass).toBe("kore-standard");
  const loki = await compact("infra/environments/local/values/loki.yaml");
  expect(loki).toMatch(
    /persistence:\{[^}]*labels:\{platform\.kore\.dev\/retention:Delete\}/,
  );
  expect(loki).toContain("storageClass:kore-standard");
  expect(loki).not.toContain("Retain");
});

test("Tempo stores traces on a labelled claim instead of an unlabellable claim template", async () => {
  // tempo 1.24.4 (the final, deprecated chart) renders volumeClaimTemplates
  // without labels, so the claim comes from the observability config chart.
  const tempo = await compact("infra/environments/local/values/tempo.yaml");
  expect(tempo).toContain("persistence:{enabled:false}");
  expect(tempo).toContain(
    "{name:storage,persistentVolumeClaim:{claimName:tempo-storage}}",
  );
  expect(tempo).toContain("{name:storage,mountPath:/var/tempo}");
  const [claim] = await documents(
    "infra/observability/config/templates/tempo-storage.yaml",
  );
  expect(claim).toMatch(/^kind: PersistentVolumeClaim$/m);
  expect(claim).toMatch(/^  name: tempo-storage$/m);
  expect(claim).toMatch(/platform\.kore\.dev\/retention: Delete/);
  expect(claim).toMatch(/storageClassName: kore-standard/);
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "tempo",
  );
  expect(component?.dependencies).toContain("kore-observability-config");
});

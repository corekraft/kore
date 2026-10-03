import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadImageLock, imageForApplication } from "./image-lock.js";

test("loads an application image only when its lock entry is immutable and signed", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-image-lock-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await writeFile(
    join(root, "infra/catalog/images.lock.json"),
    JSON.stringify({
      version: 1,
      authorizedSigners: ["release@kore.dev"],
      entries: {
        reference: {
          image: "registry.kore.local/reference",
          digest: "sha256:" + "a".repeat(64),
          signer: "release@kore.dev",
        },
      },
    }),
  );

  const lock = await loadImageLock(root);
  expect(imageForApplication(lock, "reference")).toEqual({
    reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    signer: "release@kore.dev",
  });
});

test("allows an immutable image from a registry exposed on an explicit port", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-image-lock-port-"));
  await writeFile(
    join(root, "images.lock.json"),
    JSON.stringify({
      version: 1,
      authorizedSigners: ["release@kore.dev"],
      entries: {
        reference: {
          image: "registry.kore.local:30500/reference",
          digest: "sha256:" + "a".repeat(64),
          signer: "release@kore.dev",
        },
      },
    }),
  );
  await expect(loadImageLock(root, "images.lock.json")).resolves.toBeTruthy();
});

test.each([
  [
    "tag-only",
    {
      image: "registry.kore.local/reference:latest",
      digest: "",
      signer: "release@kore.dev",
    },
  ],
  [
    "missing signer",
    {
      image: "registry.kore.local/reference",
      digest: "sha256:" + "b".repeat(64),
      signer: "",
    },
  ],
  [
    "invalid digest",
    {
      image: "registry.kore.local/reference",
      digest: "sha256:bad",
      signer: "release@kore.dev",
    },
  ],
])("rejects an image lock with %s trust data", async (_case, entry) => {
  const root = await mkdtemp(join(tmpdir(), "kore-image-lock-invalid-"));
  await writeFile(
    join(root, "images.lock.json"),
    JSON.stringify({
      version: 1,
      authorizedSigners: ["release@kore.dev"],
      entries: { reference: entry },
    }),
  );
  await expect(loadImageLock(root, "images.lock.json")).rejects.toThrow(
    /image lock|digest|signer/i,
  );
});

test("refuses applications without a locked image", () => {
  expect(() =>
    imageForApplication(
      { version: 1, authorizedSigners: ["release@kore.dev"], entries: {} },
      "reference",
    ),
  ).toThrow(/no locked image/i);
});

test("rejects a locked image signed by an unauthorized identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-image-lock-signer-"));
  await writeFile(
    join(root, "images.lock.json"),
    JSON.stringify({
      version: 1,
      authorizedSigners: ["release@kore.dev"],
      entries: {
        reference: {
          image: "registry.kore.local/reference",
          digest: "sha256:" + "a".repeat(64),
          signer: "developer@kore.dev",
        },
      },
    }),
  );
  await expect(loadImageLock(root, "images.lock.json")).rejects.toThrow(
    /unauthorized signer/i,
  );
});

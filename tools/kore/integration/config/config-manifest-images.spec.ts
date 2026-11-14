import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  approvedImageList,
  findRoot,
  loadRepository,
} from "../../src/config/index.js";
import { manifestImages } from "../../src/config/manifest-images.js";
import { unapprovedImages } from "../../src/images/index.js";

// Reads the committed manifests of the local environment, so it is an integration test (ADR 0098).
// The config barrel does not export manifestImages, so this file reads it from its module.

async function yamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? yamlFiles(join(dir, entry.name))
        : [join(dir, entry.name)],
    ),
  );
  return nested.flat().filter((file) => /\.ya?ml$/.test(file));
}

test("every image or package a plain manifest installs is pinned by digest and approved", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const sources = new Set([
    "infra/apis",
    ...repository.catalog.components.flatMap((c) =>
      c.kind === "manifest" && c.source && !/^https?:/.test(c.source)
        ? [c.source]
        : [],
    ),
  ]);
  const approved = approvedImageList(repository).map((entry) => entry.image);
  const files = (
    await Promise.all([...sources].map((s) => yamlFiles(join(root, s))))
  ).flat();
  expect(files.length).toBeGreaterThan(0);
  const refs = (
    await Promise.all(
      files.map(async (file) => {
        const text = await readFile(file, "utf8");
        return manifestImages(text).map((ref) => ({ file, ref }));
      }),
    )
  ).flat();
  // The Function packages are the manifest-installed images today.
  expect(refs.map((r) => r.ref).join("\n")).toContain("function-go-templating");
  const problems = refs.flatMap(({ file, ref }) =>
    unapprovedImages([ref], approved).map(
      (p) => `${file.slice(root.length + 1)}: ${p}`,
    ),
  );
  expect(problems).toEqual([]);
});

import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { contextInputs, sourceTagOf } from "./local-image-context.js";

// Docs: AGENTS.md "Deploy what was verified." (a stale tag must never be reused)

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function context(
  files: Record<string, string>,
  dockerignore = "node_modules\n.git\n",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-reuse-context-"));
  roots.push(root);
  await writeFile(join(root, "Dockerfile"), "FROM scratch\n");
  await writeFile(join(root, ".dockerignore"), dockerignore);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const hashOf = async (root: string) => (await contextInputs(root)).hash;

test("the same content hashes the same, wherever the directory is", async () => {
  const files = { "src/a.ts": "a", "package.json": "{}" };
  expect(await hashOf(await context(files))).toBe(
    await hashOf(await context(files)),
  );
});

test("a file's bytes cannot be reframed as another file: NUL bytes in content never collide", async () => {
  const joined = await context({ a: "x\0b\0y" });
  const split = await context({ a: "x", b: "y" });
  const shifted = await context({ "a\0x": "b\0y" }).catch(() => undefined);

  expect(await hashOf(joined)).not.toBe(await hashOf(split));
  if (shifted !== undefined) {
    expect(await hashOf(shifted)).not.toBe(await hashOf(joined));
  }
});

test("a mode change alone changes the hash", async () => {
  const root = await context({ "bin/run.sh": "echo" });
  const before = await hashOf(root);

  await chmod(join(root, "bin/run.sh"), 0o755);

  expect(await hashOf(root)).not.toBe(before);
});

test("a symlink target change changes the hash, and the link is never followed", async () => {
  const root = await context({ "src/a.ts": "a" });
  await symlink("/nonexistent/one", join(root, "link"));
  const before = await hashOf(root);

  await unlink(join(root, "link"));
  await symlink("/nonexistent/two", join(root, "link"));

  expect(await hashOf(root)).not.toBe(before);
});

test("a symlink to a file outside the context hashes the target path, not that file's content", async () => {
  const outside = await context({ "secret.txt": "one" });
  const root = await context({});
  await symlink(join(outside, "secret.txt"), join(root, "link"));
  const before = await hashOf(root);

  await writeFile(join(outside, "secret.txt"), "two");

  expect(await hashOf(root)).toBe(before);
});

test("node_modules is excluded only at the root, as .dockerignore says", async () => {
  const root = await context({
    "node_modules/dep/index.js": "one",
    "src/node_modules/dep/index.js": "one",
  });
  const before = await hashOf(root);

  await writeFile(join(root, "node_modules/dep/index.js"), "two");
  expect(await hashOf(root)).toBe(before);

  await writeFile(join(root, "src/node_modules/dep/index.js"), "two");
  expect(await hashOf(root)).not.toBe(before);
});

test("a .dockerignore pattern with a wildcard, and a negation, decide what counts", async () => {
  const root = await context(
    { "a.log": "1", "keep.log": "1", "docs/b.log": "1", "src/x.ts": "1" },
    "*.log\n!keep.log\n",
  );
  const before = await hashOf(root);

  await writeFile(join(root, "a.log"), "2");
  expect(await hashOf(root)).toBe(before);
  await writeFile(join(root, "keep.log"), "2");
  expect(await hashOf(root)).not.toBe(before);
  const afterKeep = await hashOf(root);
  // `*` does not cross a slash, so a nested .log is not matched by `*.log`.
  await writeFile(join(root, "docs/b.log"), "2");
  expect(await hashOf(root)).not.toBe(afterKeep);
});

test("the Dockerfile and .dockerignore count even when .dockerignore would exclude them", async () => {
  const root = await context(
    { "src/x.ts": "1" },
    "Dockerfile\n.dockerignore\n",
  );
  const before = await hashOf(root);

  await writeFile(join(root, "Dockerfile"), "FROM scratch\nRUN true\n");

  expect(await hashOf(root)).not.toBe(before);
});

test("a missing directory has no hash, so the build names it instead of a stale reuse", async () => {
  await expect(
    contextInputs(join(tmpdir(), "kore-reuse-context-does-not-exist")),
  ).resolves.toEqual({ hash: undefined, dockerfile: undefined });
});

test("the tag changes with the base image digest and with the platform", () => {
  const base = sourceTagOf(
    "a".repeat(64),
    ["node@sha256:" + "1".repeat(64)],
    "linux/arm64",
  );

  expect(base).toMatch(/^kore-src-[0-9a-f]{16}$/);
  expect(base).toBe(
    sourceTagOf(
      "a".repeat(64),
      ["node@sha256:" + "1".repeat(64)],
      "linux/arm64",
    ),
  );
  expect(
    sourceTagOf(
      "a".repeat(64),
      ["node@sha256:" + "2".repeat(64)],
      "linux/arm64",
    ),
  ).not.toBe(base);
  expect(
    sourceTagOf(
      "a".repeat(64),
      ["node@sha256:" + "1".repeat(64)],
      "linux/amd64",
    ),
  ).not.toBe(base);
  expect(
    sourceTagOf(
      "b".repeat(64),
      ["node@sha256:" + "1".repeat(64)],
      "linux/arm64",
    ),
  ).not.toBe(base);
});

test("`**/` matches whole directories only, so a file that merely resembles one still counts", async () => {
  const root = await context(
    { "a/b": "1", "a/x/y/b": "1", "a/xb": "1" },
    "a/**/b\n",
  );
  const before = await hashOf(root);

  await writeFile(join(root, "a/b"), "2");
  await writeFile(join(root, "a/x/y/b"), "2");
  expect(await hashOf(root)).toBe(before);

  await writeFile(join(root, "a/xb"), "2");
  expect(await hashOf(root)).not.toBe(before);
});

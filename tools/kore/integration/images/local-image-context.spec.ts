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
import { contextInputs } from "../../src/testing/index.js";

// Docs: AGENTS.md "Deploy what was verified." (a stale tag must never be reused)

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function context(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kore-reuse-context-"));
  roots.push(root);
  await writeFile(join(root, "Dockerfile"), "FROM scratch\n");
  await writeFile(join(root, ".dockerignore"), "node_modules\n.git\n");
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

test("a missing directory has no hash, so the build names it instead of a stale reuse", async () => {
  await expect(
    contextInputs(join(tmpdir(), "kore-reuse-context-does-not-exist")),
  ).resolves.toEqual({ hash: undefined, dockerfile: undefined });
});

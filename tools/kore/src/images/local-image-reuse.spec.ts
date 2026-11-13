import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import { digest, entry, fakeRunner } from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";

// Docs: AGENTS.md "It just works." (a no-change rerun is a no-op, not a rollout)

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("./registry-https.js", () => ({ registryHead }));

const roots: string[] = [];

afterEach(async () => {
  registryReference.mockReset();
  registryHead.mockReset();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function checkout(source = "v1"): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-local-reuse-"));
  roots.push(root);
  const app = join(root, "apps/reference");
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(join(app, "Dockerfile"), "FROM scratch\n");
  await writeFile(join(app, "src/server.ts"), source);
  return { ...(await loadRepository("local")), root };
}

/** A registry where run tags resolve and a source tag resolves only when held. */
function registryWith(tags: Map<string, string>): void {
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );
  registryHead.mockImplementation(async (url: string) => {
    const tag = String(url).split("/manifests/")[1]!;
    if (!tag.startsWith("kore-src-")) {
      return { status: 200, digest };
    }
    const found = tags.get(tag);
    return found ? { status: 200, digest: found } : { status: 404, digest: "" };
  });
}

function pushedTags(calls: { args: readonly string[] }[]): string[] {
  return calls
    .flatMap(({ args }) => args.join("\n").match(/images push[^\n]*/g) ?? [])
    .map((line) => line.replace(/.*\/reference:([^' ]+).*/, "$1"));
}

test("unchanged source reuses the published digest with no build and no publish", async () => {
  const repository = await checkout();
  const first = fakeRunner();
  registryWith(new Map());
  const firstRun = await buildAndSignLocalImage(
    repository,
    first.runner,
    "reference",
    entry,
  );
  const sourceTag = pushedTags(first.calls).find((tag) =>
    tag.startsWith("kore-src-"),
  )!;
  expect(sourceTag).toMatch(/^kore-src-[0-9a-f]{16}$/);
  registryWith(new Map([[sourceTag, digest]]));

  const second = fakeRunner({ secretExists: true });
  const secondRun = await buildAndSignLocalImage(
    repository,
    second.runner,
    "reference",
    entry,
  );

  expect(secondRun.image).toEqual(firstRun.image);
  expect(second.calls.some(({ command }) => command === "docker")).toBe(false);
  expect(second.calls.some(({ command }) => command === "k3d")).toBe(false);
  expect(pushedTags(second.calls)).toEqual([]);
});

test("a reused image is signed again, because the key may be new", async () => {
  const repository = await checkout();
  const first = fakeRunner();
  registryWith(new Map());
  await buildAndSignLocalImage(repository, first.runner, "reference", entry);
  const sourceTag = pushedTags(first.calls).find((t) =>
    t.startsWith("kore-src-"),
  )!;
  registryWith(new Map([[sourceTag, digest]]));

  const second = fakeRunner();
  await buildAndSignLocalImage(repository, second.runner, "reference", entry);

  const sign = second.calls.find(({ args }) => args[0] === "sign")!;
  expect(sign.args.at(-1)).toContain(`@${digest}`);
});

test("changed source builds and publishes again under a new source tag", async () => {
  const first = fakeRunner();
  const before = await checkout("v1");
  registryWith(new Map());
  await buildAndSignLocalImage(before, first.runner, "reference", entry);
  const sourceTag = pushedTags(first.calls).find((t) =>
    t.startsWith("kore-src-"),
  )!;
  registryWith(new Map([[sourceTag, digest]]));

  const second = fakeRunner();
  await buildAndSignLocalImage(
    await checkout("v2"),
    second.runner,
    "reference",
    entry,
  );

  expect(second.calls.some(({ command }) => command === "docker")).toBe(true);
  const secondTag = pushedTags(second.calls).find((t) =>
    t.startsWith("kore-src-"),
  );
  expect(secondTag).toMatch(/^kore-src-[0-9a-f]{16}$/);
  expect(secondTag).not.toBe(sourceTag);
});

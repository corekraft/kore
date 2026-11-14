import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../../src/config/index.js";
import { afterEach, expect, test, vi } from "vitest";
import { buildAndSignLocalImage } from "../../src/images/index.js";
import {
  imageBaseDigest as baseDigest,
  imageDigest as digest,
  imageEntry as entry,
  imageFakeRunner as fakeRunner,
} from "../../src/testing/index.js";
import {
  appOf,
  builds,
  checkout,
  pushedSourceTags,
  removeCheckouts,
  reuseRegistry,
} from "./local-image-reuse-support.js";

// Docs: AGENTS.md "It just works." (a no-change rerun is a no-op, not a rollout)

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("../../src/images/registry.js", () => ({
  ensureRegistryForward: vi.fn(),
  localRegistryReference: registryReference,
}));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("../../src/images/registry-https.js", () => ({ registryHead }));

const { registryWith, published } = reuseRegistry({
  reference: registryReference,
  head: registryHead,
});

afterEach(async () => {
  registryReference.mockReset();
  registryHead.mockReset();
  vi.restoreAllMocks();
  await removeCheckouts();
});

test("unchanged source reuses the published digest with no build, no import and no publish", async () => {
  const repository = await checkout();
  const first = fakeRunner();
  registryWith(new Map());
  const firstRun = await buildAndSignLocalImage(
    repository,
    first.runner,
    "reference",
    entry,
  );
  registryWith(new Map([[pushedSourceTags(first.calls)[0]!, digest]]));

  const second = fakeRunner({ secretExists: true });
  const secondRun = await buildAndSignLocalImage(
    repository,
    second.runner,
    "reference",
    entry,
  );

  expect(secondRun.image).toEqual(firstRun.image);
  expect(builds(second.calls)).toEqual([]);
  expect(second.calls.some(({ command }) => command === "k3d")).toBe(false);
  expect(pushedSourceTags(second.calls)).toEqual([]);
});

test("a reused image is signed again, because the key may be new", async () => {
  const repository = await checkout();
  await published(repository);

  const second = fakeRunner();
  await buildAndSignLocalImage(repository, second.runner, "reference", entry);

  const sign = second.calls.find(({ args }) => args[0] === "sign")!;
  expect(sign.args.at(-1)).toContain(`@${digest}`);
});

const changes: [string, (repository: Repository) => Promise<void>][] = [
  [
    "a source edit",
    async (r) => await writeFile(join(appOf(r), "src/server.ts"), "v2"),
  ],
  [
    "a file mode change",
    async (r) => await chmod(join(appOf(r), "src/server.ts"), 0o755),
  ],
  [
    "a new symlink",
    async (r) => await symlink("/nonexistent", join(appOf(r), "src/link")),
  ],
  [
    "a change in a nested node_modules",
    async (r) => {
      await mkdir(join(appOf(r), "src/node_modules/dep"), { recursive: true });
      await writeFile(join(appOf(r), "src/node_modules/dep/index.js"), "x");
    },
  ],
  [
    "a Dockerfile edit",
    async (r) =>
      await writeFile(
        join(appOf(r), "Dockerfile"),
        "FROM node:26.13.0-alpine3.24\nCOPY src ./src\nUSER 1000\n",
      ),
  ],
];

test.each(changes)(
  "%s builds and publishes again under a new source tag",
  async (_name, change) => {
    const repository = await checkout();
    const before = await published(repository);
    await change(repository);

    const second = fakeRunner();
    await buildAndSignLocalImage(repository, second.runner, "reference", entry);

    expect(builds(second.calls)).toHaveLength(1);
    const [tag] = pushedSourceTags(second.calls);
    expect(tag).toMatch(/^kore-src-[0-9a-f]{16}$/);
    expect(tag).not.toBe(before);
  },
);

test("a changed base image digest builds again, though no file changed", async () => {
  const repository = await checkout();
  const before = await published(repository);

  const second = fakeRunner({ baseDigest: `sha256:${"c".repeat(64)}` });
  await buildAndSignLocalImage(repository, second.runner, "reference", entry);

  expect(builds(second.calls)).toHaveLength(1);
  expect(pushedSourceTags(second.calls)[0]).not.toBe(before);
  expect(baseDigest).not.toBe(`sha256:${"c".repeat(64)}`);
});

test("a different build platform builds again", async () => {
  const repository = await checkout();
  const before = await published(repository);

  const second = fakeRunner({ platform: "linux/amd64" });
  await buildAndSignLocalImage(repository, second.runner, "reference", entry);

  expect(builds(second.calls)).toHaveLength(1);
  expect(pushedSourceTags(second.calls)[0]).not.toBe(before);
});

test("with the flag off, an unchanged source builds and publishes again and never reads a source tag", async () => {
  const repository = await checkout("v1", false);
  registryWith(new Map());
  const first = fakeRunner();
  await buildAndSignLocalImage(repository, first.runner, "reference", entry);
  const second = fakeRunner();

  await buildAndSignLocalImage(repository, second.runner, "reference", entry);

  expect(builds(first.calls)).toHaveLength(1);
  expect(builds(second.calls)).toHaveLength(1);
  expect(pushedSourceTags(second.calls)).toEqual([]);
  expect(
    registryHead.mock.calls.some(([url]) =>
      String(url).includes("/manifests/kore-src-"),
    ),
  ).toBe(false);
});

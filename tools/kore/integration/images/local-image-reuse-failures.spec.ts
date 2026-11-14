import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Runner } from "../../src/runtime/index.js";
import { afterEach, expect, test, vi } from "vitest";
import { buildAndSignLocalImage } from "../../src/images/index.js";
import {
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

test("a base image that cannot be resolved builds, never reuses, and publishes no source tag", async () => {
  const repository = await checkout();
  await published(repository);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const second = fakeRunner();
  const failing: Runner = {
    run: async (command, args, options) => {
      if (command === "docker" && args[0] === "buildx") {
        return { stdout: "", stderr: "offline", code: 0 };
      }
      return await second.runner.run(command, args, options);
    },
  };

  await buildAndSignLocalImage(repository, failing, "reference", entry);

  expect(builds(second.calls)).toHaveLength(1);
  expect(pushedSourceTags(second.calls)).toEqual([]);
  expect(stderr).toHaveBeenCalledWith(
    expect.stringMatching(/could not resolve the base image.*apps\/reference/),
  );
});

test("a registry error that is not a missing tag fails the run: no build, no reuse", async () => {
  const repository = await checkout();
  await published(repository);
  registryHead.mockImplementation(async (url: string) =>
    String(url).includes("/manifests/kore-src-")
      ? { status: 500, digest: "" }
      : { status: 200, digest },
  );
  const second = fakeRunner();

  await expect(
    buildAndSignLocalImage(repository, second.runner, "reference", entry),
  ).rejects.toThrow(/HTTP 500/);

  expect(builds(second.calls)).toEqual([]);
  expect(second.calls.some(({ args }) => args[0] === "sign")).toBe(false);
});

test("an edit during the build keeps the old source tag off the new image", async () => {
  const repository = await checkout();
  registryWith(new Map());
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const run = fakeRunner();
  const editing: Runner = {
    run: async (command, args, options) => {
      const result = await run.runner.run(command, args, options);
      if (command === "docker" && args[0] === "build") {
        await writeFile(join(appOf(repository), "src/server.ts"), "edited");
      }
      return result;
    },
  };

  const built = await buildAndSignLocalImage(
    repository,
    editing,
    "reference",
    entry,
  );

  expect(built.image.digest).toBe(digest); // this run still deploys what it built
  expect(pushedSourceTags(run.calls)).toEqual([]);
  expect(stderr).toHaveBeenCalledWith(
    expect.stringMatching(/changed during the build/),
  );
});

test("a missing Dockerfile builds so docker names the problem, with no source tag", async () => {
  const repository = await checkout();
  await rm(join(appOf(repository), "Dockerfile"));
  registryWith(new Map());
  const run = fakeRunner();

  await buildAndSignLocalImage(repository, run.runner, "reference", entry);

  expect(builds(run.calls)).toHaveLength(1);
  expect(pushedSourceTags(run.calls)).toEqual([]);
});

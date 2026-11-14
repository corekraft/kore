import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  baseDigest,
  digest,
  entry,
  fakeRunner,
} from "./local-image-fixtures.js";
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
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

/** A checkout whose app directory is `apps/reference`; `kore-reuse-` names its temp roots. */
async function checkout(source = "v1"): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-reuse-"));
  roots.push(root);
  const app = join(root, "apps/reference");
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(
    join(app, "Dockerfile"),
    "FROM node:26.13.0-alpine3.24\nCOPY src ./src\n",
  );
  await writeFile(join(app, ".dockerignore"), "node_modules\n.git\n");
  await writeFile(join(app, "src/server.ts"), source);
  return { ...(await loadRepository("local")), root };
}

const appOf = (repository: Repository) =>
  join(repository.root, "apps/reference");

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

const builds = (calls: { command: string; args: readonly string[] }[]) =>
  calls.filter((c) => c.command === "docker" && c.args[0] === "build");

function pushedSourceTags(calls: { args: readonly string[] }[]): string[] {
  return calls
    .flatMap(({ args }) => args.join("\n").match(/images push[^\n]*/g) ?? [])
    .flatMap((line) => line.match(/kore-src-[0-9a-f]{16}/g) ?? []);
}

/** Runs once to publish the source tag, then returns a registry that holds it. */
async function published(repository: Repository, runner = fakeRunner()) {
  registryWith(new Map());
  await buildAndSignLocalImage(repository, runner.runner, "reference", entry);
  const [tag] = pushedSourceTags(runner.calls);
  expect(tag).toMatch(/^kore-src-[0-9a-f]{16}$/);
  registryWith(new Map([[tag!, digest]]));
  return tag!;
}

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

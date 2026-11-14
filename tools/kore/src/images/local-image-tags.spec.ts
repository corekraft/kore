import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import { entry, fakeRunner, stubRegistry } from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";

// Docs: AGENTS.md "Deploy what was verified."

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("./registry-https.js", () => ({ registryHead }));

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function checkout(): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-local-tags-"));
  roots.push(root);
  return { ...(await loadRepository("local")), root };
}

/** The tags one build used: docker build, node import, registry copy and digest read-back. */
async function tagsOfOneBuild() {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const headsBefore = registryHead.mock.calls.length;
  await buildAndSignLocalImage(await checkout(), runner, "reference", entry);
  const argv = (command: string, first: string) =>
    calls.find((call) => call.command === command && call.args[0] === first)!
      .args;
  const build = argv("docker", "build");
  const built = build[build.indexOf("--tag") + 1]!;
  const imported = argv("k3d", "image")[2];
  const read = String(registryHead.mock.calls[headsBefore]![0]).split(
    "/manifests/",
  )[1];
  const published = JSON.stringify(calls.map((call) => call.args));
  return { built, imported, read, published };
}

test("each build names its image by a tag of its own, never the shared mutable one", async () => {
  const first = await tagsOfOneBuild();
  const second = await tagsOfOneBuild();

  for (const run of [first, second]) {
    expect(run.built).toMatch(
      /^kore-local\/reference:kore-local-[0-9a-f]{12}$/,
    );
    expect(run.built).not.toBe("kore-local/reference:kore-local");
  }
  expect(second.built).not.toBe(first.built);
});

test("a build imports, copies and reads back the digest of the tag it built", async () => {
  const run = await tagsOfOneBuild();
  const tag = run.built.split(":")[1]!;

  expect(run.imported).toBe(run.built);
  expect(run.read).toBe(tag);
  expect(run.published).toContain(`reference:${tag}`);
  expect(run.published).not.toContain('reference:kore-local"');
  expect(run.read).not.toBe("kore-local");
});

test("the host tag of a finished build is removed so per-run tags do not pile up", async () => {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(await checkout(), runner, "reference", entry);

  const build = calls.find((call) => call.args[0] === "build")!.args;
  const built = build[build.indexOf("--tag") + 1];
  expect(
    calls.find((call) => call.command === "docker" && call.args[0] === "image")
      ?.args,
  ).toEqual(["image", "rm", built]);
});

test("the host tag is removed even when the build fails after it", async () => {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const failing: typeof runner = {
    ...runner,
    run: async (command, args, options) => {
      if (command === "cosign" && args[0] === "sign") {
        throw new Error("sign failed");
      }
      return await runner.run(command, args, options);
    },
  };

  await expect(
    buildAndSignLocalImage(await checkout(), failing, "reference", entry),
  ).rejects.toThrow("sign failed");

  expect(
    calls.some(
      (call) =>
        call.command === "docker" &&
        call.args[0] === "image" &&
        call.args[1] === "rm",
    ),
  ).toBe(true);
});

test("a second build landing mid-run leaves the first run deploying the digest it pushed", async () => {
  // A registry where a push overwrites its tag, as a real one does.
  const registry = new Map<string, string>();
  const pushed: string[] = [];
  const digestOfPush = (n: number) =>
    `sha256:${n.toString(16).padStart(64, "0")}`;
  registryHead.mockImplementation(async (url: string) => ({
    status: 200,
    digest: registry.get(String(url).split("/manifests/")[1] ?? ""),
  }));
  registryReference.mockImplementation(
    async (_repo: unknown, _runner: unknown, reference: string) => reference,
  );
  const { runner } = fakeRunner();
  let secondDone = false;
  const racing: typeof runner = {
    ...runner,
    run: async (command, args, options) => {
      const result = await runner.run(command, args, options);
      const push = /reference:(kore-local(?:-[0-9a-f]{12})?)'/.exec(
        args.join(" "),
      );
      if (
        command === "docker" &&
        args.join(" ").includes("images push") &&
        push
      ) {
        const digest = digestOfPush(pushed.length + 1);
        pushed.push(digest);
        registry.set(push[1]!, digest);
        if (pushed.length === 1 && !secondDone) {
          secondDone = true;
          // Another worktree's build publishes before the first reads its digest.
          await buildAndSignLocalImage(
            await checkout(),
            racing,
            "reference",
            entry,
          );
        }
      }
      return result;
    },
  };

  const first = await buildAndSignLocalImage(
    await checkout(),
    racing,
    "reference",
    entry,
  );

  expect(pushed).toHaveLength(2);
  expect(first.image.digest).toBe(pushed[0]);
  expect(first.image.digest).not.toBe(pushed[1]);
});

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import type { ImageLockEntry } from "./image-lock.js";
import { buildAndSignLocalImage } from "./local-image.js";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));

const roots: string[] = [];
const digest = `sha256:${"d".repeat(64)}`;

afterEach(async () => {
  vi.unstubAllGlobals();
  registryReference.mockReset();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function testRepository(): Promise<Repository> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), "kore-local-image-")),
  );
  roots.push(root);
  const repository = await loadRepository("local");
  return { ...repository, root };
}

function fakeRunner(options: { clusterIp?: string } = {}) {
  const calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions;
  }[] = [];
  const runner: Runner = {
    async run(command, args, runOptions): Promise<RunResult> {
      calls.push({
        command,
        args,
        ...(runOptions ? { options: runOptions } : {}),
      });
      if (command === "cosign" && args[0] === "generate-key-pair") {
        const prefix = args[args.indexOf("--output-key-prefix") + 1]!;
        await writeFile(`${prefix}.key`, "local private key");
        await writeFile(`${prefix}.pub`, "local public key");
      }
      if (command === "cosign" && args[0] === "signing-config") {
        const path = args[args.indexOf("--out") + 1]!;
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "{}");
      }
      return {
        stdout: command === "kubectl" ? (options.clusterIp ?? "10.0.0.8") : "",
        stderr: "",
        code: 0,
      };
    },
  };
  return { runner, calls };
}

const entry: ImageLockEntry = {
  image: "registry.kore.local:30500/reference",
  digest: `sha256:${"a".repeat(64)}`,
  signer: "release@kore.dev",
};

test("build and sign creates a protected keypair and locks the registry digest", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 200,
      headers: { "docker-content-digest": digest },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );

  const result = await buildAndSignLocalImage(
    repository,
    runner,
    "reference",
    entry,
  );

  const key = join(repository.root, ".kore/keys/local/automation.key");
  const publicKey = join(repository.root, ".kore/keys/local/automation.pub");
  const signingConfig = join(
    repository.root,
    ".kore/state/local-signing-config.json",
  );
  expect(result).toEqual({
    image: {
      reference: `${entry.image}@${digest}`,
      digest,
      signer: "local-kore-key",
    },
    publicKey,
  });
  expect(await readFile(key, "utf8")).toBe("local private key");
  expect(
    (await stat(join(repository.root, ".kore/keys/local"))).mode & 0o777,
  ).toBe(0o700);
  expect((await stat(key)).mode & 0o777).toBe(0o600);
  expect((await stat(publicKey)).mode & 0o777).toBe(0o644);
  expect(await readFile(signingConfig, "utf8")).toBe("{}");
  expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:30500/v2/reference/manifests/kore-local",
    expect.objectContaining({ method: "HEAD" }),
  );
  expect(registryReference).toHaveBeenCalledTimes(2);
  expect(
    calls
      .filter(({ command }) => command === "cosign")
      .map(({ args }) => args[0]),
  ).toEqual(["generate-key-pair", "signing-config", "sign"]);
});

test("build and sign reuses an existing local signer", async () => {
  const repository = await testRepository();
  const directory = join(repository.root, ".kore/keys/local");
  const state = join(repository.root, ".kore/state");
  await mkdir(directory, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(join(directory, "automation.key"), "private");
  await writeFile(join(directory, "automation.pub"), "public");
  await writeFile(join(state, "local-signing-config.json"), "{}");
  const { runner, calls } = fakeRunner();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "docker-content-digest": digest },
      }),
    ),
  );
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(
    calls
      .filter(({ command }) => command === "cosign")
      .map(({ args }) => args[0]),
  ).toEqual(["sign"]);
});

test("build and sign rejects an incomplete local signer keypair", async () => {
  const repository = await testRepository();
  const directory = join(repository.root, ".kore/keys/local");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "automation.key"), "private");
  const { runner, calls } = fakeRunner();

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow(/key pair is incomplete/);
  expect(calls).toEqual([]);
});

test("build and sign rejects a registry response without a usable digest", async () => {
  const repository = await testRepository();
  const { runner } = fakeRunner();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  );
  registryReference.mockImplementation(
    async (_repo, _runner, reference) => reference,
  );

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow(/HTTP 404/);
});

test("build and sign rejects when the local registry service has no address", async () => {
  const repository = await testRepository();
  const { runner } = fakeRunner({ clusterIp: "" });

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow(/registry service or image repository path is unavailable/);
});

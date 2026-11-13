import { loadRepository } from "../config/index.js";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { type Repository } from "../config/index.js";
import {
  digest,
  entry,
  fakeRunner,
  filesUnder,
  kubeContext,
  minifiedKubeconfig,
  secretRef,
  stubRegistry,
} from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("./registry-https.js", () => ({ registryHead }));

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  registryReference.mockReset();
  registryHead.mockReset();
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

test("build and sign generates the key pair as a Kubernetes Secret through the configured context and writes no private key", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  const result = await buildAndSignLocalImage(
    repository,
    runner,
    "reference",
    entry,
  );

  const publicKey = join(
    repository.root,
    ".kore/state/environments/local/local-signing.pub",
  );
  expect(result).toEqual({
    image: {
      reference: `10.96.0.50:5000/reference@${digest}`,
      digest,
      signer: "local-kore-key",
    },
    publicKey,
  });
  expect(await readFile(publicKey, "utf8")).toBe("local public key");
  const generate = calls.find(({ args }) => args[0] === "generate-key-pair")!;
  expect(generate.command).toBe("cosign");
  expect(generate.args).toEqual(["generate-key-pair", secretRef]);
  expect(calls.map(({ command, args }) => [command, ...args])).toContainEqual([
    "kubectl",
    "--context",
    kubeContext,
    "--namespace",
    "kore-system",
    "get",
    "secret",
    "kore-local-signing-key",
    "--ignore-not-found",
    "--output=name",
  ]);
  expect(calls.map(({ command, args }) => [command, ...args])).toContainEqual([
    "kubectl",
    "config",
    "view",
    "--minify",
    "--raw",
    "--context",
    kubeContext,
  ]);
  const sign = calls.find(({ args }) => args[0] === "sign")!;
  expect(sign.args).toEqual(expect.arrayContaining(["--key", secretRef]));
  const files = await filesUnder(repository.root);
  expect(files.filter((file) => /\.key$|cosign\.key/.test(file))).toEqual([]);
  expect(files.filter((file) => file.includes(".kore/keys"))).toEqual([]);
});

test("cosign is pinned to the configured context through an in-memory kubeconfig, never a file", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const before = new Set(await readdir(tmpdir()));

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const generate = calls.find(({ args }) => args[0] === "generate-key-pair")!;
  const sign = calls.find(({ args }) => args[0] === "sign")!;
  expect(generate.options?.kubeconfig).toBe(minifiedKubeconfig);
  expect(sign.options?.kubeconfig).toBe(minifiedKubeconfig);
  for (const call of [generate, sign]) {
    expect(call.options?.env?.KUBECONFIG).toBeUndefined();
    expect(JSON.stringify(call.args)).not.toContain("kubeconfig");
  }
  const created = (await readdir(tmpdir())).filter((name) => !before.has(name));
  for (const name of created) {
    for (const file of await filesUnder(join(tmpdir(), name))) {
      expect(await readFile(file, "utf8").catch(() => "")).not.toContain(
        minifiedKubeconfig.trim(),
      );
    }
  }
});

test("build and sign accepts a kubeconfig that embeds credentials because it never reaches disk", async () => {
  const repository = await testRepository();
  const embedded = `${minifiedKubeconfig}    client-key-data: c2VjcmV0\n`;
  const { runner, calls } = fakeRunner({ kubeconfig: embedded });
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const sign = calls.find(({ args }) => args[0] === "sign")!;
  expect(sign.options?.kubeconfig).toBe(embedded);
  expect(JSON.stringify(sign.args)).not.toContain("c2VjcmV0");
});

test("build and sign reuses the key Secret already in the cluster", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner({ secretExists: true });
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(
    calls
      .filter(({ command }) => command === "cosign")
      .map(({ args }) => args[0]),
  ).toEqual(["sign"]);
});

test("a legacy key under .kore is never used and is reported as deletable", async () => {
  const repository = await testRepository();
  const directory = join(repository.root, ".kore/keys/local");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "automation.key"), "private");
  await writeFile(join(directory, "automation.pub"), "public");
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(
    calls.find(({ args }) => args[0] === "generate-key-pair"),
  ).toBeTruthy();
  expect(JSON.stringify(calls)).not.toContain("automation.key");
  expect(stderr).toHaveBeenCalledWith(
    expect.stringMatching(/\.kore\/keys\/local.*can be deleted/),
  );
  expect(await readFile(join(directory, "automation.key"), "utf8")).toBe(
    "private",
  );
  stderr.mockRestore();
});

test("build and sign rejects a registry response without a usable digest", async () => {
  const repository = await testRepository();
  const { runner } = fakeRunner();
  registryHead.mockResolvedValue({ status: 404, digest: "" });
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
  ).rejects.toThrow(/no ClusterIP/);
});

test("key generation runs in a private temp directory so cosign.pub never lands in the caller's working directory", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const before = existsSync(join(process.cwd(), "cosign.pub"));

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const generate = calls.find(({ args }) => args[0] === "generate-key-pair")!;
  const cwd = generate.options?.cwd;
  expect(cwd).toBeDefined();
  expect(cwd!.startsWith(tmpdir())).toBe(true);
  expect(cwd!.startsWith(repository.root)).toBe(false);
  expect(existsSync(cwd!)).toBe(false);
  expect(existsSync(join(process.cwd(), "cosign.pub"))).toBe(before);
  const files = await filesUnder(repository.root);
  expect(files.filter((file) => file.endsWith("cosign.pub"))).toEqual([]);
});

test("build and sign pushes to the environment's registry.address, not a live lookup", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const publish = calls.find((c) => c.args.some((a) => a.includes("push")));
  expect(publish?.args.join(" ")).toContain(
    "'10.96.0.50:5000/reference:kore-local'",
  );
});

test("build and sign fails with the fix when the Service is not at registry.address", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner({ clusterIp: "10.99.1.2" });

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow(
    /10\.99\.1\.2.*registry\.address 10\.96\.0\.50:5000.*kore platform up/s,
  );
  expect(calls.some((c) => c.args.some((a) => a.includes("push")))).toBe(false);
});

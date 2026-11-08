import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
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

const kubeContext = "kore-local";
const secretRef = "k8s://kore-system/kore-local-signing-key";
const minifiedKubeconfig = `apiVersion: v1
kind: Config
current-context: ${kubeContext}
clusters:
  - name: kore-local
    cluster: {server: "https://192.168.49.2:8443", certificate-authority: /home/u/.minikube/ca.crt}
contexts:
  - name: ${kubeContext}
    context: {cluster: kore-local, user: kore-local}
users:
  - name: kore-local
    user: {client-certificate: /home/u/.minikube/client.crt, client-key: /home/u/.minikube/client.key}
`;

// The real cosign writes cosign.pub into its working directory.
async function writeCosignPub(cwd: string | undefined): Promise<void> {
  await writeFile(join(cwd ?? process.cwd(), "cosign.pub"), "pub");
}

function fakeRunner(
  options: {
    clusterIp?: string;
    secretExists?: boolean;
    kubeconfig?: string;
  } = {},
) {
  const calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions;
  }[] = [];
  let exists = options.secretExists ?? false;
  const runner: Runner = {
    async run(command, args, runOptions): Promise<RunResult> {
      calls.push({
        command,
        args,
        ...(runOptions ? { options: runOptions } : {}),
      });
      let stdout = "";
      if (command === "cosign" && args[0] === "generate-key-pair") {
        exists = true;
        await writeCosignPub(runOptions?.cwd);
      }
      if (command === "kubectl") {
        if (args.includes("secret") && args.includes("--output=name")) {
          stdout = exists ? "secret/kore-local-signing-key\n" : "";
        } else if (
          args.some((arg) => arg.startsWith("--output=jsonpath={.data"))
        ) {
          stdout = Buffer.from("local public key").toString("base64");
        } else if (args.includes("config")) {
          stdout = options.kubeconfig ?? minifiedKubeconfig;
        } else {
          stdout = options.clusterIp ?? "10.96.0.50";
        }
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function stubRegistry(): void {
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
}

const entry: ImageLockEntry = {
  image: "registry.kore.local:30500/reference",
  digest: `sha256:${"a".repeat(64)}`,
  signer: "release@kore.dev",
};

test("build and sign generates the key pair as a Kubernetes Secret through the configured context and writes no private key", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry();

  const result = await buildAndSignLocalImage(
    repository,
    runner,
    "reference",
    entry,
  );

  const publicKey = join(repository.root, ".kore/state/local-signing.pub");
  expect(result).toEqual({
    image: {
      reference: `${entry.image}@${digest}`,
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
    "--context",
    kubeContext,
  ]);
  const sign = calls.find(({ args }) => args[0] === "sign")!;
  expect(sign.args).toEqual(expect.arrayContaining(["--key", secretRef]));
  const files = await filesUnder(repository.root);
  expect(files.filter((file) => /\.key$|cosign\.key/.test(file))).toEqual([]);
  expect(files.filter((file) => file.includes(".kore/keys"))).toEqual([]);
});

test("cosign is pinned to the configured context through a kubeconfig that is removed afterwards", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry();

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  const generate = calls.find(({ args }) => args[0] === "generate-key-pair")!;
  const sign = calls.find(({ args }) => args[0] === "sign")!;
  const kubeconfig = generate.options?.env?.KUBECONFIG;
  expect(kubeconfig).toBeTruthy();
  expect(sign.options?.env?.KUBECONFIG).toBe(kubeconfig);
  expect(kubeconfig?.startsWith(repository.root)).toBe(false);
  await expect(stat(kubeconfig!)).rejects.toThrow(/ENOENT/);
});

test("build and sign refuses a kubeconfig that embeds credentials", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner({
    kubeconfig: `${minifiedKubeconfig}    client-key-data: c2VjcmV0\n`,
  });

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow(/embeds credentials/);
  expect(calls.some(({ command }) => command === "cosign")).toBe(false);
});

test("build and sign reuses the key Secret already in the cluster", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner({ secretExists: true });
  stubRegistry();

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
  stubRegistry();
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
  ).rejects.toThrow(/no ClusterIP/);
});

test("key generation runs in a private temp directory so cosign.pub never lands in the caller's working directory", async () => {
  const repository = await testRepository();
  const { runner, calls } = fakeRunner();
  stubRegistry();
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
  stubRegistry();

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

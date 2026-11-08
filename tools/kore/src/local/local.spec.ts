import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { localDown, localUp } from "./local.js";
import {
  imageDigestFromRegistryHead,
  localDockerBuildArgs,
  minikubeImageLoadArgs,
  minikubeImagePublishArgs,
} from "../images/local-image.js";

test("local image build uses the application Dockerfile and context", () => {
  expect(
    localDockerBuildArgs(
      "/repo/apps/reference",
      "127.0.0.1:30500/reference:kore-local",
    ),
  ).toEqual([
    "build",
    "--file",
    "/repo/apps/reference/Dockerfile",
    "--tag",
    "127.0.0.1:30500/reference:kore-local",
    "/repo/apps/reference",
  ]);
});

test("local image load stages the source-built image into the selected Minikube node", () => {
  expect(
    minikubeImageLoadArgs("kore-local", "kore-local/reference:kore-local"),
  ).toEqual([
    "image",
    "load",
    "--profile",
    "kore-local",
    "--daemon",
    "kore-local/reference:kore-local",
  ]);
});

test("Minikube publishes the staged image to the in-cluster registry over HTTP", () => {
  expect(
    minikubeImagePublishArgs(
      "kore-local",
      "kore-local/reference:kore-local",
      "10.102.17.251:5000",
      "reference:kore-local",
    ),
  ).toEqual([
    "ssh",
    "--profile",
    "kore-local",
    "--",
    "sudo nerdctl --namespace k8s.io tag 'kore-local/reference:kore-local' '10.102.17.251:5000/reference:kore-local' && sudo nerdctl --insecure-registry --namespace k8s.io push '10.102.17.251:5000/reference:kore-local'",
  ]);
});

test("local image digest comes from the registry manifest response header", () => {
  const digest = "sha256:" + "a".repeat(64);
  expect(
    imageDigestFromRegistryHead(200, `Docker-Content-Digest: ${digest}\r\n`),
  ).toBe(digest);
  expect(() => imageDigestFromRegistryHead(404, "")).toThrow(/manifest/i);
});

test("local up starts the platform before reconciling every locked application", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];

  await localUp(repository, {} as never, {
    platformUp: async () => {
      calls.push("platform");
    },
    syncSecrets: async () => {
      calls.push("secrets");
      return 1;
    },
    buildImage: async (_repository, _runner, name) => {
      calls.push(`build:${name}`);
      return {
        image: {
          reference:
            "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
          digest: "sha256:" + "a".repeat(64),
          signer: "local-kore-key",
        },
        publicKey: "/repo/.kore/state/local-signing.pub",
      };
    },
    appUp: async (_repository, _runner, name, image) => {
      calls.push(`deploy:${name}:${image?.digest}`);
    },
  });

  expect(calls).toEqual([
    "platform",
    "secrets",
    "build:reference",
    `deploy:reference:sha256:${"a".repeat(64)}`,
  ]);
});

test("local down preserves cluster state unless pruning is explicitly requested", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];

  await localDown(
    repository,
    {} as never,
    { prune: false, purgeData: false },
    {
      platformStop: async () => {
        calls.push("stop");
      },
      platformDestroy: async (_repository, _runner, options) => {
        calls.push(`destroy:${options.yes}:${options.purgeData}`);
      },
    },
  );
  await localDown(
    repository,
    {} as never,
    { prune: true, purgeData: false },
    {
      platformStop: async () => {
        calls.push("stop");
      },
      platformDestroy: async (_repository, _runner, options) => {
        calls.push(`destroy:${options.yes}:${options.purgeData}`);
      },
    },
  );
  await localDown(
    repository,
    {} as never,
    { prune: true, purgeData: true },
    {
      platformStop: async () => {
        calls.push("stop");
      },
      platformDestroy: async (_repository, _runner, options) => {
        calls.push(`destroy:${options.yes}:${options.purgeData}`);
      },
    },
  );

  expect(calls).toEqual(["stop", "destroy:true:false", "destroy:true:true"]);
});

test("local lifecycle refuses managed environments", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  await expect(localUp(repository, {} as never)).rejects.toThrow(
    /only manage Minikube environments/,
  );
  await expect(
    localDown(repository, {} as never, { prune: false, purgeData: false }),
  ).rejects.toThrow(/only manage Minikube environments/);
});

test("purging retained data without --prune is refused before anything is touched", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];
  await expect(
    localDown(
      repository,
      {} as never,
      { prune: false, purgeData: true },
      {
        platformStop: async () => {
          calls.push("stop");
        },
        platformDestroy: async () => {
          calls.push("destroy");
        },
      },
    ),
  ).rejects.toThrow(/--purge-data requires --prune/);
  expect(calls).toEqual([]);
});

async function staleKeyRepository() {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-local-stale-key-"));
  const state = join(root, ".kore/state");
  await mkdir(state, { recursive: true });
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await copyFile(
    join(base.root, "infra/catalog/images.lock.json"),
    join(root, "infra/catalog/images.lock.json"),
  );
  await writeFile(join(state, "local-images.lock.json"), "stale");
  await writeFile(join(state, "local-signing.pub"), "vanished public key");
  return { repository: { ...base, root }, state, root };
}

test("local down --prune forgets the digest and public key of the destroyed signing key", async () => {
  const { repository, state, root } = await staleKeyRepository();
  try {
    await localDown(
      repository,
      {} as never,
      { prune: true, purgeData: false },
      {
        platformDestroy: async () => undefined,
      },
    );
    await expect(stat(join(state, "local-images.lock.json"))).rejects.toThrow(
      /ENOENT/,
    );
    await expect(stat(join(state, "local-signing.pub"))).rejects.toThrow(
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local down without prune keeps the signed local digests because the key survives", async () => {
  const { repository, state, root } = await staleKeyRepository();
  try {
    await localDown(
      repository,
      {} as never,
      { prune: false, purgeData: false },
      {
        platformStop: async () => undefined,
      },
    );
    expect(await readFile(join(state, "local-images.lock.json"), "utf8")).toBe(
      "stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local up discards a local lock left by a vanished signing key before re-signing", async () => {
  const { repository, state, root } = await staleKeyRepository();
  let lockDuringBuild: string | undefined = "unset";
  try {
    await localUp(repository, {} as never, {
      platformUp: async () => undefined,
      syncSecrets: async () => 0,
      buildImage: async () => {
        lockDuringBuild = await readFile(
          join(state, "local-images.lock.json"),
          "utf8",
        ).catch(() => undefined);
        return {
          image: {
            reference: `registry.kore.local:30500/reference@sha256:${"a".repeat(64)}`,
            digest: `sha256:${"a".repeat(64)}`,
            signer: "local-kore-key",
          },
          publicKey: join(state, "local-signing.pub"),
        };
      },
      appUp: async () => undefined,
    });
    expect(lockDuringBuild).toBeUndefined();
    expect(
      JSON.parse(await readFile(join(state, "local-images.lock.json"), "utf8"))
        .entries.reference.digest,
    ).toBe(`sha256:${"a".repeat(64)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

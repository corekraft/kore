// Docs: infra/plans/14-test-tiers.md#step-2-pilots
// Real units together, no cluster: the local lifecycle reads the committed
// image lock and the real local overlay, and the stale-key guarantees run on
// real files. The platform, app and image steps are injected fakes, so nothing
// here runs a process. The unit specs in src/local cover each unit alone.
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
import { loadRepository } from "../src/config/index.js";
import { localDown, localUp } from "../src/local/index.js";
import {
  imageDigestFromRegistryHead,
  localDockerBuildArgs,
} from "../src/images/index.js";
import { loadManagedLocal } from "../src/testing/index.js";

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

test("local image digest comes from the registry manifest response header", () => {
  const digest = "sha256:" + "a".repeat(64);
  expect(
    imageDigestFromRegistryHead(200, `Docker-Content-Digest: ${digest}\r\n`),
  ).toBe(digest);
  expect(() => imageDigestFromRegistryHead(404, "")).toThrow(/manifest/i);
});

test("the real local overlay is a k3d environment with the k3d context", async () => {
  const { environment } = await loadRepository("local");
  expect(environment.provider).toBe("k3d");
  expect(environment.kubeContext).toBe("k3d-kore-local");
});

async function k3dRepository() {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-local-k3d-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await copyFile(
    join(base.root, "infra/catalog/images.lock.json"),
    join(root, "infra/catalog/images.lock.json"),
  );
  return { repository: { ...base, root }, root };
}

test("local up composes platform, secrets, images and applications for k3d in order", async () => {
  const { repository, root } = await k3dRepository();
  const calls: string[] = [];
  try {
    await localUp(repository, {} as never, {
      platformUp: async () => {
        calls.push("platform");
      },
      pruneImageTags: async () => undefined,
      syncSecrets: async () => {
        calls.push("secrets");
        return 0;
      },
      buildImage: async (_repository, _runner, name) => {
        calls.push(`build:${name}`);
        return {
          image: {
            reference: "r",
            digest: "sha256:a",
            signer: "local-kore-key",
          },
          publicKey: "pub",
        } as never;
      },
      appUp: async (_repository, _runner, name) => {
        calls.push(`app:${name}`);
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  expect(calls[0]).toBe("platform");
  expect(calls[1]).toBe("secrets");
  expect(calls.slice(2).some((call) => call.startsWith("build:"))).toBe(true);
  expect(calls.slice(2).some((call) => call.startsWith("app:"))).toBe(true);
});

test("the local lifecycle refuses managed environments, read from the managed fixture", async () => {
  const repository = await loadManagedLocal();
  await expect(localUp(repository, {} as never)).rejects.toThrow(
    /only manage k3d environments/,
  );
  await expect(
    localDown(repository, {} as never, { prune: false, purgeData: false }),
  ).rejects.toThrow(/only manage k3d environments/);
});

async function staleKeyRepository() {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-local-stale-key-"));
  const state = join(root, ".kore/state/environments/local");
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
      pruneImageTags: async () => undefined,
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

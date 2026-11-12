import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { localDown, localUp } from "./local.js";

test("local down reaches the platform stop and destroy for a k3d environment", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "k3d" as const },
  };
  const calls: string[] = [];
  const dependencies = {
    platformStop: async () => {
      calls.push("stop");
    },
    platformDestroy: async (
      _repository: unknown,
      _runner: unknown,
      options: { yes: boolean; purgeData: boolean },
    ) => {
      calls.push(`destroy:${options.yes}:${options.purgeData}`);
    },
  };
  await localDown(
    repository,
    {} as never,
    { prune: false, purgeData: false },
    dependencies,
  );
  await localDown(
    repository,
    {} as never,
    { prune: true, purgeData: false },
    dependencies,
  );
  expect(calls).toEqual(["stop", "destroy:true:false"]);
});

test("local down --prune --purge-data passes purgeData through for k3d", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "k3d" as const },
  };
  const seen: { yes: boolean; purgeData: boolean }[] = [];
  await localDown(
    repository,
    {} as never,
    { prune: true, purgeData: true },
    {
      platformDestroy: async (_repository, _runner, options) => {
        seen.push(options);
      },
    },
  );
  expect(seen).toEqual([{ yes: true, purgeData: true }]);
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

test("the real local overlay is a k3d environment with the k3d context", async () => {
  const { environment } = await loadRepository("local");
  expect(environment.provider).toBe("k3d");
  expect(environment.kubeContext).toBe("k3d-kore-local");
});

test("local up composes platform, secrets, images and applications for k3d in order", async () => {
  const { repository, root } = await k3dRepository();
  const calls: string[] = [];
  try {
    await localUp(repository, {} as never, {
      platformUp: async () => {
        calls.push("platform");
      },
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

test("local stop stops the k3d cluster and keeps its data", async () => {
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
      platformDestroy: async () => {
        calls.push("destroy");
      },
    },
  );
  expect(calls).toEqual(["stop"]);
});

test("the local lifecycle refuses a managed environment and names k3d", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  await expect(localUp(repository, {} as never)).rejects.toThrow(/k3d/);
});

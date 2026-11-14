import { loadRepository } from "../../src/config/index.js";
import { expect, test } from "vitest";
import { type Repository } from "../../src/config/index.js";
import { fakeRunner } from "../../src/images/images.fixtures.js";
import {
  k3dImageImportArgs,
  loadLocalImage,
} from "../../src/images/local-image.js";

const tag = "kore-local/reference:kore-local";

async function k3dRepository(): Promise<Repository> {
  const base = await loadRepository("local");
  const { cluster: _cluster, ...environment } = base.environment;
  return {
    ...base,
    root: "/repo",
    environment: {
      ...environment,
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
    },
  };
}

test("k3d image import names the tag and the cluster", () => {
  expect(k3dImageImportArgs("kore-local", tag)).toEqual([
    "image",
    "import",
    tag,
    "--cluster",
    "kore-local",
  ]);
});

test("a k3d environment imports the built image with k3d and issues no other cluster command and no node shell", async () => {
  const { runner, calls } = fakeRunner();

  await loadLocalImage(await k3dRepository(), runner, "reference", tag);

  expect(calls.map(({ command }) => command)).toEqual(["docker", "k3d"]);
  expect(calls[1]!.args).toEqual([
    "image",
    "import",
    tag,
    "--cluster",
    "kore-local",
  ]);
});

test("a k3d overlay without k3d settings fails naming the missing settings", async () => {
  const { runner, calls } = fakeRunner();
  const repository = await k3dRepository();
  const { k3d: _k3d, ...environment } = repository.environment;

  await expect(
    loadLocalImage({ ...repository, environment }, runner, "reference", tag),
  ).rejects.toThrow(/environment\.k3d\.clusterName/);
  expect(calls.map(({ command }) => command)).not.toContain("k3d");
});

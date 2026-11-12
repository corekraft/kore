import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import { expect, test } from "vitest";
import { type Repository } from "../config/index.js";
import { fakeRunner } from "./local-image-fixtures.js";
import { k3dImageImportArgs, loadLocalImage } from "./local-image.js";

const tag = "kore-local/reference:kore-local";

async function k3dRepository(): Promise<Repository> {
  const base = await loadMinikubeLocal();
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

test("a k3d environment imports the built image with k3d and issues no minikube command", async () => {
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

test("a minikube environment still loads the built image with minikube", async () => {
  const { runner, calls } = fakeRunner();
  const repository = await loadMinikubeLocal();

  await loadLocalImage(repository, runner, "reference", tag);

  expect(calls.map(({ command }) => command)).toEqual(["docker", "minikube"]);
  expect(calls[1]!.args).toEqual([
    "image",
    "load",
    "--profile",
    repository.environment.cluster!.profile,
    "--daemon",
    tag,
  ]);
});

test("a k3d overlay without k3d settings fails naming the missing settings, not Minikube", async () => {
  const { runner, calls } = fakeRunner();
  const repository = await k3dRepository();
  const { k3d: _k3d, ...environment } = repository.environment;

  await expect(
    loadLocalImage({ ...repository, environment }, runner, "reference", tag),
  ).rejects.toThrow(/environment\.k3d\.clusterName/);
  expect(calls.map(({ command }) => command)).not.toContain("minikube");
});

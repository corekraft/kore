import { expect, test } from "vitest";
import { loadRepository } from "./config.js";
import { localDown, localUp } from "./local.js";
import { imageDigestFromRegistryHead, localDockerBuildArgs, localSigningConfigArgs, minikubeImageLoadArgs, minikubeImagePublishArgs } from "./local-image.js";

test("local image build uses the application Dockerfile and context", () => {
  expect(localDockerBuildArgs("/repo/apps/reference", "127.0.0.1:30500/reference:kore-local")).toEqual([
    "build", "--file", "/repo/apps/reference/Dockerfile", "--tag", "127.0.0.1:30500/reference:kore-local", "/repo/apps/reference",
  ]);
});

test("local image load stages the source-built image into the selected Minikube node", () => {
  expect(minikubeImageLoadArgs("kore-local", "kore-local/reference:kore-local")).toEqual([
    "image", "load", "--profile", "kore-local", "--daemon", "kore-local/reference:kore-local",
  ]);
});

test("Minikube publishes the staged image to the in-cluster registry over HTTP", () => {
  expect(minikubeImagePublishArgs("kore-local", "kore-local/reference:kore-local", "10.102.17.251", "reference:kore-local")).toEqual([
    "ssh", "--profile", "kore-local", "--",
    "sudo nerdctl --namespace k8s.io tag 'kore-local/reference:kore-local' '10.102.17.251:5000/reference:kore-local' && sudo nerdctl --insecure-registry --namespace k8s.io push '10.102.17.251:5000/reference:kore-local'",
  ]);
});

test("local image digest comes from the registry manifest response header", () => {
  const digest = "sha256:" + "a".repeat(64);
  expect(imageDigestFromRegistryHead(200, `Docker-Content-Digest: ${digest}\r\n`)).toBe(digest);
  expect(() => imageDigestFromRegistryHead(404, "")).toThrow(/manifest/i);
});

test("local signing config deliberately omits transparency-log services", () => {
  expect(localSigningConfigArgs("/repo/.kore/state/local-signing-config.json")).toEqual([
    "signing-config", "create", "--with-default-services", "--no-default-rekor", "--no-default-tsa", "--out", "/repo/.kore/state/local-signing-config.json",
  ]);
});

test("local up starts the platform before reconciling every locked application", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];

  await localUp(repository, {} as never, {
    platformUp: async () => { calls.push("platform"); },
    syncSecrets: async () => { calls.push("secrets"); return 1; },
    buildImage: async (_repository, _runner, name) => {
      calls.push(`build:${name}`);
      return { image: { reference: "registry.kore.local:30500/reference@sha256:" + "a".repeat(64), digest: "sha256:" + "a".repeat(64), signer: "local-kore-key" }, publicKey: "/repo/.kore/keys/local/automation.pub" };
    },
    appUp: async (_repository, _runner, name, image) => { calls.push(`deploy:${name}:${image?.digest}`); },
  });

  expect(calls).toEqual(["platform", "secrets", "build:reference", `deploy:reference:sha256:${"a".repeat(64)}`]);
});

test("local down preserves cluster state unless pruning is explicitly requested", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];

  await localDown(repository, {} as never, false, {
    platformStop: async () => { calls.push("stop"); },
    platformDestroy: async (_repository, _runner, options) => {
      calls.push(`destroy:${options.yes}:${options.purgeData}`);
    },
  });
  await localDown(repository, {} as never, true, {
    platformStop: async () => { calls.push("stop"); },
    platformDestroy: async (_repository, _runner, options) => {
      calls.push(`destroy:${options.yes}:${options.purgeData}`);
    },
  });

  expect(calls).toEqual(["stop", "destroy:true:true"]);
});

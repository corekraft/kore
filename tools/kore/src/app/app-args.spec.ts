import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { imageReleaseArgs, localImagePullPolicyArgs } from "./release.js";
import { verifyLockedImageArgs, localPublicKeyPath } from "./verify.js";
import {
  localMinikubeImageReference,
  minikubeImagePullArgs,
} from "./local-image.js";
import {
  deploymentListArgs,
  deploymentRolloutStatusArgs,
} from "./readiness.js";

test("workload release uses the immutable locked image reference", async () => {
  const repository = await loadRepository("local");
  expect(
    imageReleaseArgs(repository, "reference", {
      reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
      digest: "sha256:" + "a".repeat(64),
      signer: "release@kore.dev",
    }),
  ).toEqual([
    "--set-string",
    "image.repository=registry.kore.local/reference",
    "--set-string",
    "image.digest=sha256:" + "a".repeat(64),
  ]);
});

test("image verification is bound to the locked signer and digest", () => {
  expect(
    verifyLockedImageArgs({
      reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
      digest: "sha256:" + "a".repeat(64),
      signer: "release@kore.dev",
    }),
  ).toEqual([
    "verify",
    "--certificate-identity",
    "release@kore.dev",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "registry.kore.local/reference@sha256:" + "a".repeat(64),
  ]);
});

test("a registry with a port never switches cosign to plain HTTP: it verifies over TLS against the given CA", () => {
  expect(
    verifyLockedImageArgs(
      {
        reference:
          "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
        digest: "sha256:" + "a".repeat(64),
        signer: "release@kore.dev",
      },
      undefined,
      "/tmp/ca.crt",
    ),
  ).toEqual([
    "verify",
    "--registry-cacert",
    "/tmp/ca.crt",
    "--certificate-identity",
    "release@kore.dev",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
  ]);
});

test("local image verification uses the generated public key", () => {
  expect(
    verifyLockedImageArgs(
      {
        reference: "127.0.0.1:30500/reference@sha256:" + "a".repeat(64),
        digest: "sha256:" + "a".repeat(64),
        signer: "local-kore-key",
      },
      "/workspace/.kore/keys/local/kore.pub",
      "/tmp/ca.crt",
    ),
  ).toEqual([
    "verify",
    "--registry-cacert",
    "/tmp/ca.crt",
    "--insecure-ignore-tlog",
    "--key",
    "/workspace/.kore/keys/local/kore.pub",
    "127.0.0.1:30500/reference@sha256:" + "a".repeat(64),
  ]);
});

test("image reference helpers reject missing immutable digest and local registry inputs", () => {
  const image = {
    reference: "registry.kore.local/reference:dev",
    digest: "sha256:" + "a".repeat(64),
    signer: "release@kore.dev",
  };
  expect(() => imageReleaseArgs({} as never, "reference", image)).toThrow(
    /must include a digest/,
  );
  expect(() => localMinikubeImageReference("invalid", "10.0.0.1")).toThrow(
    /reference and registry address are required/,
  );
  expect(() => localMinikubeImageReference("registry/image:dev", "  ")).toThrow(
    /reference and registry address are required/,
  );
});

test("Minikube stages the locked digest under the registry service reference", () => {
  const reference = localMinikubeImageReference(
    "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
    "10.102.135.66:5000",
  );
  expect(reference).toBe(
    "10.102.135.66:5000/reference@sha256:" + "a".repeat(64),
  );
  const args = minikubeImagePullArgs(
    "kore-local",
    reference,
    "10.102.135.66:5000",
    "kore-read",
  );
  expect(args.slice(0, 5)).toEqual([
    "ssh",
    "--profile",
    "kore-local",
    "--native-ssh=false",
    "--",
  ]);
  expect(args[5]).toContain("--password-stdin");
  expect(args[5]).toContain("nerdctl --namespace k8s.io pull");
  expect(args[5]).toContain(reference);
});

test("local workload releases never pull the already-loaded image", () => {
  expect(localImagePullPolicyArgs()).toEqual([
    "--set-string",
    "image.pullPolicy=Never",
  ]);
});

test("deployment rollout status targets a named deployment", () => {
  expect(deploymentRolloutStatusArgs("reference")).toEqual([
    "rollout",
    "status",
    "deployment/reference",
    "--timeout=10m",
  ]);
});

test("deployment discovery uses kubectl get", () => {
  expect(deploymentListArgs()).toEqual(["get", "deployment", "--output=name"]);
});

test("local verification reads the public key published from the cluster Secret, never the legacy key directory", () => {
  const path = localPublicKeyPath("/workspace");
  expect(path).toBe("/workspace/.kore/state/local-signing.pub");
  expect(path).not.toContain("keys");
});

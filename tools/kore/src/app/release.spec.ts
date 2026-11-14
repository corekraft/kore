// Docs: docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider, registryPlan } from "../config/index.js";
import { digest, fakeImage, fakeRepository } from "./app-support.js";
import {
  imageReleaseArgs,
  localImagePullPolicyArgs,
  releaseArgs,
} from "./release.js";

vi.mock("../config/index.js");

const repository = fakeRepository();

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue({
    address: "registry.kore.local:30500",
  } as ReturnType<typeof registryPlan>);
});

test("a release upgrades in the configured context, waits, and rolls back a failed upgrade", () => {
  const args = releaseArgs(repository, "reference", "reference", "/charts/w");
  expect(args.slice(0, 10)).toEqual([
    "upgrade",
    "--install",
    "reference",
    "/charts/w",
    "--namespace",
    "reference",
    "--kube-context",
    "k3d-kore-local",
    "--wait",
    "--timeout",
  ]);
  expect(args).toContain("--rollback-on-failure");
  expect(args).not.toContain("--atomic");
});

test("a release passes the gateway, registry, secret store and telemetry settings from the environment", () => {
  expect(
    releaseArgs(repository, "reference", "reference", "/charts/w"),
  ).toEqual(
    expect.arrayContaining([
      "platform.gateway.name=kore-gateway",
      "platform.gateway.namespace=kore-system",
      "platform.gateway.hostname=kore.local",
      "platform.registry.address=registry.kore.local:30500",
      "platform.secretStore=kore-store",
      "platform.otlpEndpoint=http://otel.kore-system:4318",
    ]),
  );
  expect(registryPlan).toHaveBeenCalledWith(repository.environment);
});

test("a release sets no image and no secret version when neither is given", () => {
  const args = releaseArgs(repository, "reference", "reference", "/charts/w");
  expect(args.join(" ")).not.toMatch(/image\.|secretVersion=/);
});

test("a release carries the secret version only when the source has one", () => {
  const args = releaseArgs(repository, "reference", "reference", "/charts/w", {
    secretVersion: "v1",
  });
  expect(args.slice(-2)).toEqual(["--set-string", "secretVersion=v1"]);
});

test("a local image release pulls only from the node store, and a managed one never sets the policy", () => {
  const image = fakeImage();
  const local = releaseArgs(repository, "reference", "reference", "/c", {
    image,
  });
  expect(local.slice(-2)).toEqual(["--set-string", "image.pullPolicy=Never"]);

  vi.mocked(isLocalProvider).mockReturnValue(false);
  const managed = releaseArgs(repository, "reference", "reference", "/c", {
    image,
  });
  expect(managed.join(" ")).not.toContain("pullPolicy");
});

test("a release deploys its image by repository and digest, never by tag", () => {
  const args = releaseArgs(repository, "reference", "reference", "/c", {
    image: fakeImage(),
  });
  expect(args).toEqual(
    expect.arrayContaining([
      "image.repository=registry.kore.local:30500/reference",
      `image.digest=${digest}`,
    ]),
  );
});

test("an image reference without a digest is refused, so no release is rendered from a tag", () => {
  expect(() =>
    imageReleaseArgs(repository, "reference", {
      ...fakeImage(),
      reference: "registry.kore.local/reference:dev",
    }),
  ).toThrow("locked image reference must include a digest");
});

test("the image arguments name the repository before the digest, in Helm's string form", () => {
  expect(imageReleaseArgs(repository, "reference", fakeImage())).toEqual([
    "--set-string",
    "image.repository=registry.kore.local:30500/reference",
    "--set-string",
    `image.digest=${digest}`,
  ]);
});

test("the local pull policy is never Always or IfNotPresent", () => {
  expect(localImagePullPolicyArgs()).toEqual([
    "--set-string",
    "image.pullPolicy=Never",
  ]);
});

// Docs: docs/decisions/0028-image-trust-authority.md
import { beforeEach, expect, test, vi } from "vitest";
import { enrollmentExemptionErrors } from "./enrollment.js";
import {
  imagePolicyComponent,
  imageTrustErrors,
  localSigner,
  noMatchPolicy,
  registryGlob,
  trustedSigners,
} from "./image-trust.js";
import { registryPlan, type RegistryPlan } from "./registry-address.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
  fakeSeeds,
} from "./config-support.js";
import type { Component, Environment, Repository } from "./types.js";

// Factories, not automocks: the collaborators' real modules never load here.
vi.mock("./enrollment.js", () => ({ enrollmentExemptionErrors: vi.fn() }));
vi.mock("./registry-address.js", () => ({ registryPlan: vi.fn() }));

const release =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.2.3";
const keylessTrust = {
  type: "keyless",
  mode: "warn",
  issuer: "https://token.actions.githubusercontent.com",
  subjects: [release],
};
const keyTrust = {
  type: "key",
  mode: "warn",
  keyRef: { name: "local-kore-key", namespace: "cosign-system" },
};
const components = [
  fakeComponent({ name: "kore-image-policy" }),
  fakeComponent({ name: "policy-controller", namespace: "cosign-system" }),
];

/** A repository with only the fields the image trust checks read. */
function repositoryWith(options: {
  trust?: Record<string, unknown> | undefined;
  provider?: Environment["provider"];
  components?: Component[];
  seeds?: unknown[];
}): Repository {
  return fakeRepository({
    environment: fakeEnvironment({
      name: "local",
      provider: options.provider ?? "k3d",
    }),
    catalog: fakeCatalog(options.components ?? components),
    seeds: fakeSeeds(options.seeds ?? []),
    ...(options.trust === undefined
      ? {}
      : { imageTrustValues: { trust: options.trust } }),
  });
}

beforeEach(() => {
  vi.mocked(enrollmentExemptionErrors).mockReturnValue([]);
  vi.mocked(registryPlan).mockReturnValue({
    address: "registry.example:5000",
  } as RegistryPlan);
});

test("the policy component, and the local signer's name, are the values the chart and signing use", () => {
  expect(imagePolicyComponent).toBe("kore-image-policy");
  expect(localSigner).toBe("local-kore-key");
});

test("a key authority trusts exactly the local signer", () => {
  expect(trustedSigners(repositoryWith({ trust: keyTrust }))).toEqual([
    "local-kore-key",
  ]);
});

test("a keyless authority trusts exactly its release subjects, dropping blank or non-text entries", () => {
  const trust = { ...keylessTrust, subjects: [release, "  ", 42] };
  expect(trustedSigners(repositoryWith({ trust }))).toEqual([release]);
});

test("an environment with no trust authority trusts no signer", () => {
  expect(trustedSigners(repositoryWith({ trust: undefined }))).toEqual([]);
});

test("the no-match policy is warn only while the trust mode is warn, and deny for enforce", () => {
  expect(noMatchPolicy(repositoryWith({ trust: keylessTrust }))).toBe("warn");
  expect(
    noMatchPolicy(
      repositoryWith({ trust: { ...keylessTrust, mode: "enforce" } }),
    ),
  ).toBe("deny");
});

test("the no-match policy fails closed to deny when the trust is missing or its mode is unknown", () => {
  expect(noMatchPolicy(repositoryWith({ trust: undefined }))).toBe("deny");
  expect(
    noMatchPolicy(
      repositoryWith({ trust: { ...keylessTrust, mode: "audit" } }),
    ),
  ).toBe("deny");
});

test("the registry glob is the registry address that the plan reads, followed by everything under it", () => {
  const repository = repositoryWith({ trust: keylessTrust });
  expect(registryGlob(repository)).toBe("registry.example:5000/**");
  expect(vi.mocked(registryPlan).mock.calls).toEqual([
    [repository.environment],
  ]);
});

test("the trust errors start with the enrollment exemption errors, then the trust value errors", () => {
  vi.mocked(enrollmentExemptionErrors).mockReturnValue(["enrollment problem"]);
  const repository = repositoryWith({
    trust: { ...keylessTrust, mode: "audit" },
  });
  expect(imageTrustErrors(repository)).toEqual([
    "enrollment problem",
    "image trust: mode must be warn or enforce (new environments start at warn; audit before enforce)",
  ]);
  expect(vi.mocked(enrollmentExemptionErrors).mock.calls).toEqual([
    [repository],
  ]);
});

test("a sound keyless or key authority has no image trust errors", () => {
  expect(imageTrustErrors(repositoryWith({ trust: keylessTrust }))).toEqual([]);
  expect(imageTrustErrors(repositoryWith({ trust: keyTrust }))).toEqual([]);
});

test("without the image policy component no trust is required, so there are no trust errors", () => {
  const repository = repositoryWith({
    trust: undefined,
    components: [fakeComponent({ name: "kore-ui" })],
  });
  expect(imageTrustErrors(repository)).toEqual([]);
});

test("a policy component with no trust authority is rejected, naming the overlay and the environment", () => {
  expect(imageTrustErrors(repositoryWith({ trust: undefined }))).toEqual([
    "image trust authority is required: set trust in the kore-image-policy values overlay of environment local (type: key or keyless)",
  ]);
});

test("a regexp identity is refused, because it would admit other workflows or branches", () => {
  const trust = { ...keylessTrust, subjectRegExp: ".*" };
  expect(imageTrustErrors(repositoryWith({ trust }))).toEqual([
    "image trust: subjectRegExp is not allowed (regexp identities admit other workflows or branches); list exact subjects",
  ]);
});

test("a trust type other than key or keyless is rejected", () => {
  expect(
    imageTrustErrors(
      repositoryWith({ trust: { type: "password", mode: "warn" } }),
    ),
  ).toEqual(["image trust: type must be key or keyless"]);
});

test("a key authority is refused in a managed environment, which trusts only keyless identities", () => {
  expect(
    imageTrustErrors(repositoryWith({ trust: keyTrust, provider: "managed" })),
  ).toEqual([
    "image trust: managed environment local must use a keyless authority; a key authority is the local signing key and is never trusted outside the local profile",
  ]);
});

test("a keyless authority with the wrong issuer, no subjects and a keyRef reports each problem", () => {
  const trust = {
    type: "keyless",
    mode: "warn",
    issuer: "https://example.com",
    keyRef: { name: "x", namespace: "cosign-system" },
  };
  expect(imageTrustErrors(repositoryWith({ trust }))).toEqual([
    "image trust: keyless issuer must be https://token.actions.githubusercontent.com",
    "image trust: keyless needs at least one exact subject (the release workflow identity)",
    "image trust: keyless authority must not also set keyRef",
  ]);
});

test("a keyless subject that is not the exact release workflow on a release tag is rejected by value", () => {
  const branch =
    "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/heads/main";
  const trust = { ...keylessTrust, subjects: [branch] };
  expect(imageTrustErrors(repositoryWith({ trust }))).toEqual([
    `image trust: subject ${branch} must be the exact corekraft/kore release workflow on a release tag (https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/vX.Y.Z); wildcards, branches, and pull requests are not allowed`,
  ]);
});

test("a key authority whose key Secret is outside the policy-controller namespace is rejected naming that namespace", () => {
  const trust = { ...keyTrust, keyRef: { name: "k", namespace: "default" } };
  expect(imageTrustErrors(repositoryWith({ trust }))).toEqual([
    "image trust: keyRef.namespace must be cosign-system, the policy-controller namespace; Policy Controller cannot read key Secrets elsewhere. Publish a public-key-only Secret there (the local signer does this) and reference it",
  ]);
});

test("a key authority without a key Secret reference, or with keyless fields, is rejected", () => {
  const trust = { ...keyTrust, keyRef: undefined, issuer: "https://x" };
  expect(imageTrustErrors(repositoryWith({ trust }))).toEqual([
    "image trust: key authority needs keyRef.name and keyRef.namespace (the public key Secret)",
    "image trust: key authority must not also set keyless issuer or subjects",
  ]);
});

test("a hand-written images list is refused, because the registry address writes the glob once", () => {
  const trust = { ...keylessTrust, images: ["x/*"] };
  expect(imageTrustErrors(repositoryWith({ trust }))).toEqual([
    "image trust: images is derived from registry.address; remove it from the values overlay so the address is written once",
  ]);
});

test("a registry glob that covers a seed is refused, because seeds are not yet signed internal digests", () => {
  const seeds = [{ image: "registry.example:5000/kore/seed:1" }];
  expect(
    imageTrustErrors(repositoryWith({ trust: keylessTrust, seeds })),
  ).toEqual([
    "image trust: registry.address glob registry.example:5000/** covers seed registry.example:5000/kore/seed:1; seeds stay out of scope until they are rolled to signed internal digests",
  ]);
});

test("a registry address that does not parse skips the glob check rather than reporting a guess", () => {
  vi.mocked(registryPlan).mockImplementation(() => {
    throw new Error("registry.address is not an address");
  });
  const seeds = [{ image: "registry.example:5000/kore/seed:1" }];
  expect(
    imageTrustErrors(repositoryWith({ trust: keylessTrust, seeds })),
  ).toEqual([]);
});

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { expect, test } from "vitest";
import {
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import {
  appliedFlags,
  flagEntry,
  flagManifestErrors,
  neverRetires,
} from "./flag-manifest.js";
import type { FlagManifest, Repository } from "./types.js";

const manifest: FlagManifest = {
  flags: [
    {
      name: "ingress-agentgateway",
      kind: "feature",
      applies: ["local", "vps"],
    },
    {
      name: "platform-dns",
      kind: "feature",
      applies: ["local", "vps"],
      pending: true,
    },
    {
      name: "in-cluster-ca",
      kind: "environment",
      applies: ["vps"],
      neverRetire: true,
    },
    {
      name: "local-image-reuse",
      kind: "environment",
      applies: ["local"],
      neverRetire: true,
    },
    { name: "tick-self-update", kind: "harness", applies: ["local"] },
  ],
};

/** A repository of the given environment whose overlay turns on the given flags. */
function repositoryOf(
  environment: Parameters<typeof fakeEnvironment>[0],
  flags: FlagManifest = manifest,
): Repository {
  return fakeRepository({
    environment: fakeEnvironment(environment),
    flags,
  });
}

test("a declared flag reads back its entry, and an undeclared name reads as no entry", () => {
  expect(flagEntry(manifest, "ingress-agentgateway")).toEqual({
    name: "ingress-agentgateway",
    kind: "feature",
    applies: ["local", "vps"],
  });
  expect(flagEntry(manifest, "not-declared")).toBeUndefined();
});

test("an environment flag marked never-retire is reported as never retiring, and no other flag is", () => {
  expect(neverRetires(manifest, "in-cluster-ca")).toBe(true);
  expect(neverRetires(manifest, "ingress-agentgateway")).toBe(false);
  expect(neverRetires(manifest, "tick-self-update")).toBe(false);
  expect(neverRetires(manifest, "not-declared")).toBe(false);
});

test("the flags that apply to vps are the entries that list vps, in manifest order, with a pending flag left out", () => {
  expect(appliedFlags(manifest, "vps")).toEqual([
    "ingress-agentgateway",
    "in-cluster-ca",
  ]);
});

test("a harness flag applies only to the environment its entry lists, and a pending flag is left out of local too", () => {
  expect(appliedFlags(manifest, "local")).toEqual([
    "ingress-agentgateway",
    "local-image-reuse",
    "tick-self-update",
  ]);
});

test("a manifest whose entries are each sound has no errors", () => {
  expect(flagManifestErrors(repositoryOf({ name: "local" }))).toEqual([]);
});

test("a flag declared twice is refused, naming the flag", () => {
  const doubled: FlagManifest = {
    flags: [manifest.flags[0]!, manifest.flags[0]!],
  };
  expect(flagManifestErrors(repositoryOf({ name: "local" }, doubled))).toEqual([
    "flag ingress-agentgateway is declared more than once in infra/catalog/flags.yaml",
  ]);
});

test("an entry with a name, kind, applies or mark that is not valid is refused, naming the flag and the fix", () => {
  const broken = malformed<FlagManifest>({
    flags: [
      { name: "Bad_Name", kind: "feature", applies: ["local"] },
      { name: "bad-kind", kind: "service", applies: ["local"] },
      { name: "no-applies", kind: "feature", applies: [] },
      { name: "bad-env", kind: "feature", applies: ["Local Env"] },
      {
        name: "retire-feature",
        kind: "feature",
        applies: ["local"],
        neverRetire: true,
      },
      {
        name: "pending-text",
        kind: "feature",
        applies: ["local"],
        pending: "yes",
      },
      {
        name: "retire-text",
        kind: "environment",
        applies: ["local"],
        neverRetire: "yes",
      },
    ],
  });
  expect(
    flagManifestErrors(repositoryOf({ name: "local" }, broken)).sort(),
  ).toEqual([
    "flag Bad_Name must be lowercase letters, digits and hyphens, starting with a letter",
    "flag bad-env applies must list environment names of lowercase letters, digits and hyphens",
    "flag bad-kind kind must be feature, environment or harness",
    "flag no-applies applies must list at least one environment",
    "flag pending-text pending must be true or false",
    "flag retire-feature is marked neverRetire but is a feature flag; only an environment flag never retires (ADR 0148)",
    "flag retire-text neverRetire must be true or false",
  ]);
});

test("a manifest without a flags list is refused, naming the file", () => {
  expect(
    flagManifestErrors(
      repositoryOf(
        { name: "local" },
        malformed<FlagManifest>({ flags: undefined }),
      ),
    ),
  ).toEqual(["infra/catalog/flags.yaml must declare a flags list"]);
});

test("an overlay flag with no manifest entry is refused, naming the flag and the file to add it to", () => {
  const repository = repositoryOf({
    name: "local",
    features: { "unlisted-flag": true },
  });
  expect(flagManifestErrors(repository)).toEqual([
    "flag unlisted-flag is in the local overlay but has no entry in infra/catalog/flags.yaml; add an entry with its kind and the environments it applies to (ADR 0148)",
  ]);
});

test("an overlay flag whose entry does not list the overlay's environment is refused, naming both", () => {
  const repository = repositoryOf({
    name: "local",
    features: { "in-cluster-ca": false },
  });
  expect(flagManifestErrors(repository)).toEqual([
    "flag in-cluster-ca is in the local overlay but its entry applies to vps only; add local to its applies or remove it from the local overlay (ADR 0148)",
  ]);
});

test("a harness flag is refused in an entry that lists any environment but local, naming the flag", () => {
  const harnessOnVps: FlagManifest = {
    flags: [
      { name: "tick-self-update", kind: "harness", applies: ["local", "vps"] },
    ],
  };
  expect(
    flagManifestErrors(repositoryOf({ name: "local" }, harnessOnVps)),
  ).toEqual([
    "flag tick-self-update is a harness flag and applies to more than local; only the local harness reads harness flags, so they apply to local alone and are inert on a managed environment (ADR 0148)",
  ]);
});

test("a harness flag in the vps overlay is refused, because its entry applies to local only, and the same flag in local is not", () => {
  expect(
    flagManifestErrors(
      repositoryOf({
        name: "vps",
        provider: "managed",
        features: { "tick-self-update": false },
      }),
    ),
  ).toEqual([
    "flag tick-self-update is in the vps overlay but its entry applies to local only; add vps to its applies or remove it from the vps overlay (ADR 0148)",
  ]);
  expect(
    flagManifestErrors(
      repositoryOf({ name: "local", features: { "tick-self-update": false } }),
    ),
  ).toEqual([]);
});

test("an overlay whose every flag is declared for its environment has no errors, pending flags included", () => {
  const repository = repositoryOf({
    name: "local",
    features: {
      "ingress-agentgateway": true,
      "platform-dns": true,
      "local-image-reuse": true,
      "tick-self-update": false,
    },
  });
  expect(flagManifestErrors(repository)).toEqual([]);
});

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { expect, test } from "vitest";
import { fakeEnvironment, fakeRepository } from "./config-support.js";
import { flagManifestErrors } from "./flag-manifest.js";
import type { FlagManifest, Repository } from "./types.js";

/** A repository of the given environment whose overlay turns on the given flags. */
function repositoryOf(
  environment: Parameters<typeof fakeEnvironment>[0],
  flags: FlagManifest,
): Repository {
  return fakeRepository({
    environment: fakeEnvironment(environment),
    flags,
  });
}

/** A manifest where external-gateway needs service-listener-sets, which needs platform-shared-gateway. */
const chain: FlagManifest = {
  flags: [
    { name: "platform-shared-gateway", kind: "feature", applies: ["local"] },
    {
      name: "service-listener-sets",
      kind: "feature",
      applies: ["local"],
      requires: ["platform-shared-gateway"],
    },
    {
      name: "external-gateway",
      kind: "feature",
      applies: ["local"],
      requires: ["service-listener-sets"],
    },
  ],
};

test("a flag turned on while a flag it requires is off is refused, naming both flags and the fix", () => {
  const repository = repositoryOf(
    {
      name: "local",
      features: {
        "platform-shared-gateway": true,
        "service-listener-sets": false,
        "external-gateway": true,
      },
    },
    chain,
  );
  expect(flagManifestErrors(repository)).toEqual([
    'flag external-gateway is on in the local overlay but requires service-listener-sets, which is off there; set "service-listener-sets": true in the local overlay, or turn external-gateway off (ADR 0148)',
  ]);
});

test("a required flag the overlay leaves out counts as off, so the flag that needs it is refused", () => {
  const repository = repositoryOf(
    {
      name: "local",
      features: { "service-listener-sets": true },
    },
    chain,
  );
  expect(flagManifestErrors(repository)).toEqual([
    'flag service-listener-sets is on in the local overlay but requires platform-shared-gateway, which is off there; set "platform-shared-gateway": true in the local overlay, or turn service-listener-sets off (ADR 0148)',
  ]);
});

test("a broken link is reported once, at the flag whose own prerequisite is off, not again up the chain that holds", () => {
  const repository = repositoryOf(
    {
      name: "local",
      features: {
        "platform-shared-gateway": false,
        "service-listener-sets": true,
        "external-gateway": true,
      },
    },
    chain,
  );
  expect(flagManifestErrors(repository)).toEqual([
    'flag service-listener-sets is on in the local overlay but requires platform-shared-gateway, which is off there; set "platform-shared-gateway": true in the local overlay, or turn service-listener-sets off (ADR 0148)',
  ]);
});

test("a flag that requires several flags names every one that is off", () => {
  const several: FlagManifest = {
    flags: [
      { name: "a-flag", kind: "feature", applies: ["local"] },
      { name: "b-flag", kind: "feature", applies: ["local"] },
      {
        name: "c-flag",
        kind: "feature",
        applies: ["local"],
        requires: ["a-flag", "b-flag"],
      },
    ],
  };
  const repository = repositoryOf(
    { name: "local", features: { "c-flag": true } },
    several,
  );
  expect(flagManifestErrors(repository)).toEqual([
    'flag c-flag is on in the local overlay but requires a-flag, which is off there; set "a-flag": true in the local overlay, or turn c-flag off (ADR 0148)',
    'flag c-flag is on in the local overlay but requires b-flag, which is off there; set "b-flag": true in the local overlay, or turn c-flag off (ADR 0148)',
  ]);
});

test("a flag turned on with every flag it requires on has no error", () => {
  const repository = repositoryOf(
    {
      name: "local",
      features: {
        "platform-shared-gateway": true,
        "service-listener-sets": true,
        "external-gateway": true,
      },
    },
    chain,
  );
  expect(flagManifestErrors(repository)).toEqual([]);
});

test("a flag turned off needs nothing, whether or not the flags it requires are on", () => {
  const repository = repositoryOf(
    {
      name: "local",
      features: {
        "platform-shared-gateway": false,
        "service-listener-sets": false,
        "external-gateway": false,
      },
    },
    chain,
  );
  expect(flagManifestErrors(repository)).toEqual([]);
});

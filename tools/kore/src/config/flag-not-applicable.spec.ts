// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { expect, test } from "vitest";
import {
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import {
  appliedFlags,
  flagManifestErrors,
  notApplicableReason,
} from "./flag-manifest.js";
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

const notApplicable: FlagManifest = {
  flags: [
    {
      name: "database-routes",
      kind: "feature",
      applies: ["local", "vps"],
      notApplicable: ["vps"],
      reason: "vps keeps the 5432 passthrough off (ADR 0160).",
    },
  ],
};

test("a flag marked not applicable to an environment reads back its reason there, and nothing for an environment it applies to", () => {
  expect(notApplicableReason(notApplicable, "database-routes", "vps")).toBe(
    "vps keeps the 5432 passthrough off (ADR 0160).",
  );
  expect(
    notApplicableReason(notApplicable, "database-routes", "local"),
  ).toBeUndefined();
  expect(
    notApplicableReason(notApplicable, "not-declared", "vps"),
  ).toBeUndefined();
});

test("a flag not applicable to an environment is left out of what applies to it, and still applies to the others", () => {
  expect(appliedFlags(notApplicable, "vps")).toEqual([]);
  expect(appliedFlags(notApplicable, "local")).toEqual(["database-routes"]);
});

test("a not-applicable mark on an environment the entry does not apply to is refused, naming the flag and the environment", () => {
  const stray: FlagManifest = {
    flags: [
      {
        name: "stray-flag",
        kind: "feature",
        applies: ["local"],
        notApplicable: ["vps"],
        reason: "Not on vps.",
      },
    ],
  };
  expect(flagManifestErrors(repositoryOf({ name: "local" }, stray))).toEqual([
    "flag stray-flag is marked not applicable to vps but its applies does not list vps; mark only an environment it applies to (ADR 0148)",
  ]);
});

test("a not-applicable entry with no one-line reason is refused, naming the flag and the file to add the reason to", () => {
  const reasonless = malformed<FlagManifest>({
    flags: [
      {
        name: "no-reason",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: ["vps"],
      },
      {
        name: "two-lines",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: ["vps"],
        reason: "first\nsecond",
      },
      {
        name: "blank-reason",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: ["vps"],
        reason: "  ",
      },
    ],
  });
  expect(
    flagManifestErrors(repositoryOf({ name: "local" }, reasonless)).sort(),
  ).toEqual([
    "flag blank-reason is not applicable to vps and needs a one-line reason in infra/catalog/flags.yaml (ADR 0148)",
    "flag no-reason is not applicable to vps and needs a one-line reason in infra/catalog/flags.yaml (ADR 0148)",
    "flag two-lines is not applicable to vps and needs a one-line reason in infra/catalog/flags.yaml (ADR 0148)",
  ]);
});

test("a not-applicable mark that is not a list of environment names is refused, naming the flag", () => {
  const notAList = malformed<FlagManifest>({
    flags: [
      {
        name: "list-text",
        kind: "feature",
        applies: ["local", "vps"],
        notApplicable: "vps",
        reason: "Not on vps.",
      },
    ],
  });
  expect(flagManifestErrors(repositoryOf({ name: "local" }, notAList))).toEqual(
    [
      "flag list-text notApplicable must list environment names of lowercase letters, digits and hyphens (ADR 0148)",
    ],
  );
});

test("an overlay that turns on a flag the manifest marks not applicable to its environment is refused, naming the manifest and the reason; the flag held off is allowed", () => {
  expect(
    flagManifestErrors(
      repositoryOf(
        {
          name: "vps",
          provider: "managed",
          features: { "database-routes": true },
        },
        notApplicable,
      ),
    ),
  ).toEqual([
    "flag database-routes is on in the vps overlay but infra/catalog/flags.yaml marks it not applicable to vps (vps keeps the 5432 passthrough off (ADR 0160).); keep it off there (ADR 0148)",
  ]);
  expect(
    flagManifestErrors(
      repositoryOf(
        {
          name: "vps",
          provider: "managed",
          features: { "database-routes": false },
        },
        notApplicable,
      ),
    ),
  ).toEqual([]);
});

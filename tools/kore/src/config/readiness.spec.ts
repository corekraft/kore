// Docs: docs/decisions/0067-readiness-manifest.md
import { expect, test } from "vitest";
import { platformChecks, readinessErrors } from "./readiness.js";
import type { Catalog, ReadinessManifest, Repository } from "./types.js";

/** A repository with only the readiness and catalog fields the check reads. */
function repositoryWith(
  readiness: Record<string, unknown>,
  components: string[] = ["kore-registry", "kore-ui"],
): Pick<Repository, "readiness" | "catalog"> {
  return {
    readiness: {
      version: 1,
      requirements: [],
      ...readiness,
    } as unknown as ReadinessManifest,
    catalog: {
      components: components.map((name) => ({ name })),
    } as unknown as Catalog,
  };
}

const requirement = (
  name: string,
  components: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name,
  step: 8,
  capability: "controller",
  components,
  ...extra,
});

test("a version 1 manifest that requires every catalog component exactly once has no errors", () => {
  const repository = repositoryWith({
    requirements: [
      requirement("platform", ["kore-registry"]),
      requirement("apps", ["kore-ui"], { platformChecks: ["registry-trust"] }),
    ],
  });
  expect(readinessErrors(repository)).toEqual([]);
});

test("the platform checks a requirement may name are the registry trust and the image inventory", () => {
  expect(platformChecks).toEqual(["registry-trust", "image-inventory"]);
});

test("a manifest version this kore does not read is refused, naming the version it reads", () => {
  const repository = repositoryWith({
    version: 2,
    requirements: [
      requirement("platform", ["kore-registry"]),
      requirement("apps", ["kore-ui"]),
    ],
  });
  expect(readinessErrors(repository)).toEqual([
    "readiness manifest version 2 is unsupported: this kore reads version 1",
  ]);
});

test("a requirement name used twice is reported for the second use", () => {
  const repository = repositoryWith({
    requirements: [
      requirement("platform", ["kore-registry"]),
      requirement("platform", ["kore-ui"]),
    ],
  });
  expect(readinessErrors(repository)).toEqual([
    "duplicate requirement platform",
  ]);
});

test("a requirement whose step is outside 7 to 11 is refused, naming the step", () => {
  const repository = repositoryWith({
    requirements: [
      requirement("early", ["kore-registry"], { step: 6 }),
      requirement("late", ["kore-ui"], { step: 12 }),
    ],
  });
  expect(readinessErrors(repository)).toEqual([
    "requirement early: step 6 must be between 7 and 11",
    "requirement late: step 12 must be between 7 and 11",
  ]);
});

test("a requirement naming a component the catalog does not declare is refused", () => {
  const repository = repositoryWith({
    requirements: [
      requirement("platform", ["kore-registry", "kore-missing"]),
      requirement("apps", ["kore-ui"]),
    ],
  });
  expect(readinessErrors(repository)).toEqual([
    "requirement platform names unknown component kore-missing",
  ]);
});

test("a component required by two requirements is refused, naming both", () => {
  const repository = repositoryWith({
    requirements: [
      requirement("platform", ["kore-registry"]),
      requirement("apps", ["kore-registry", "kore-ui"]),
    ],
  });
  expect(readinessErrors(repository)).toEqual([
    "component kore-registry is required by more than one requirement (platform and apps)",
  ]);
});

test("a platform check outside the known list is refused, naming the check", () => {
  const repository = repositoryWith({
    requirements: [
      requirement("platform", ["kore-registry", "kore-ui"], {
        platformChecks: ["registry-trust", "backups"],
      }),
    ],
  });
  expect(readinessErrors(repository)).toEqual([
    "requirement platform names unknown platform check backups",
  ]);
});

test("a catalog component no requirement names is reported so it cannot be left out of the gate", () => {
  const repository = repositoryWith({
    requirements: [requirement("platform", ["kore-registry"])],
  });
  expect(readinessErrors(repository)).toEqual([
    "readiness manifest does not require component kore-ui: add it to a requirement in infra/catalog/readiness.yaml",
  ]);
});

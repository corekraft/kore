// Docs: docs/decisions/0056-platform-image-inventory.md (ADR 0056, enrollment exemptions)
import { expect, test } from "vitest";
import { enrollmentExemptionErrors } from "./enrollment.js";
import type { Environment, Repository } from "./types.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
} from "./config-support.js";

/** A repository whose catalog manages the given namespaces and whose overlay exempts the given ones. */
function repositoryWith(
  exemptions: Environment["enrollmentExemptions"] | undefined,
  namespaces: string[] = ["kore-system", "observability"],
): Repository {
  return fakeRepository({
    catalog: fakeCatalog(
      namespaces.map((namespace) =>
        fakeComponent({ name: namespace, namespace }),
      ),
    ),
    environment: fakeEnvironment(
      exemptions === undefined ? {} : { enrollmentExemptions: exemptions },
    ),
  });
}

test("an environment with no exemptions has no enrollment errors", () => {
  expect(enrollmentExemptionErrors(repositoryWith(undefined))).toEqual([]);
});

test("an exemption for a platform namespace with a reason is accepted", () => {
  expect(
    enrollmentExemptionErrors(
      repositoryWith({ "kore-system": "the platform itself" }),
    ),
  ).toEqual([]);
});

test("an exemption for a namespace the catalog does not manage is rejected by name", () => {
  expect(
    enrollmentExemptionErrors(repositoryWith({ "team-a": "a reason" })),
  ).toEqual([
    "environment.enrollmentExemptions: team-a is not a platform namespace of the catalog",
  ]);
});

test("an exemption without a reason is rejected by name", () => {
  expect(
    enrollmentExemptionErrors(repositoryWith({ observability: "   " })),
  ).toEqual(["environment.enrollmentExemptions: observability needs a reason"]);
});

test("an exemption with an unknown namespace and no reason reports both problems, in order", () => {
  expect(enrollmentExemptionErrors(repositoryWith({ "team-b": "" }))).toEqual([
    "environment.enrollmentExemptions: team-b is not a platform namespace of the catalog",
    "environment.enrollmentExemptions: team-b needs a reason",
  ]);
});

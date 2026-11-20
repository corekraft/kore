// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md
import { expect, test } from "vitest";
import { takeOwnershipWithoutReason } from "./helm-options.js";
import { fakeComponent } from "./config-support.js";

test("a release that takes over objects an earlier manifest apply created needs a reason that names them", () => {
  expect(
    takeOwnershipWithoutReason(
      fakeComponent({ helm: { takeOwnership: true } }),
    ),
  ).toBe(true);
  expect(
    takeOwnershipWithoutReason(
      fakeComponent({ helm: { takeOwnership: true, reason: " " } }),
    ),
  ).toBe(true);
  expect(
    takeOwnershipWithoutReason(
      fakeComponent({
        helm: {
          takeOwnership: true,
          reason: "adopts the manifest-applied XRD",
        },
      }),
    ),
  ).toBe(false);
});

test("a release that takes over nothing needs no takeover reason", () => {
  expect(takeOwnershipWithoutReason(fakeComponent())).toBe(false);
  expect(
    takeOwnershipWithoutReason(fakeComponent({ helm: { wait: false } })),
  ).toBe(false);
});

// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { expect, test } from "vitest";
import { backupFacts } from "./backup-facts.js";

const withData = {
  spec: {
    databases: [
      {
        name: "leads-db",
        version: 17,
        size: "10Gi",
        retentionPolicy: "Retain",
      },
    ],
  },
};

test("the facts publish the target kind the overlay declares, interim or off-host", () => {
  expect(backupFacts("interim", []).targetKind).toBe("interim");
  expect(backupFacts("off-host", []).targetKind).toBe("off-host");
});

test("the facts publish, for each service, whether it has data", () => {
  const facts = backupFacts("interim", [
    { name: "leads", manifest: withData },
    { name: "shop", manifest: { spec: { organization: "platform" } } },
  ]);
  expect(facts.services).toEqual({
    leads: { hasData: true },
    shop: { hasData: false },
  });
});

test("a service whose record cannot be read is published as having data, so the gate fails closed", () => {
  const facts = backupFacts("interim", [{ name: "shop", manifest: undefined }]);
  expect(facts.services).toEqual({ shop: { hasData: true } });
});

test("with no service records the facts carry the kind and no services", () => {
  expect(backupFacts("off-host", [])).toEqual({
    targetKind: "off-host",
    services: {},
  });
});

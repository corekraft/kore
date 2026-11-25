// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { beforeEach, expect, test, vi } from "vitest";
import { backupFacts } from "./backup-facts.js";
import { serviceHasData } from "./service-data.js";

// The has-data rule is its own unit (service-data.spec.ts), so it is mocked here (ADR 0098).
vi.mock("./service-data.js", () => ({ serviceHasData: vi.fn(() => false) }));

const leads = { spec: { databases: [{ name: "leads-db" }] } };
const shop = { spec: { organization: "platform" } };

beforeEach(() => {
  vi.mocked(serviceHasData).mockReset();
  vi.mocked(serviceHasData).mockReturnValue(false);
});

test("the facts publish the target kind the overlay declares, interim or off-host", () => {
  expect(backupFacts("interim", []).targetKind).toBe("interim");
  expect(backupFacts("off-host", []).targetKind).toBe("off-host");
});

test("the facts publish, for each service, the answer of the has-data rule to its own spec file", () => {
  vi.mocked(serviceHasData)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false);
  const facts = backupFacts("interim", [
    { name: "leads", manifest: leads },
    { name: "shop", manifest: shop },
  ]);
  expect(serviceHasData).toHaveBeenNthCalledWith(1, leads);
  expect(serviceHasData).toHaveBeenNthCalledWith(2, shop);
  expect(facts.services).toEqual({
    leads: { hasData: true },
    shop: { hasData: false },
  });
});

test("a record whose manifest cannot be read is handed to the has-data rule as it is, and the rule's answer is published", () => {
  vi.mocked(serviceHasData).mockReturnValueOnce(true);
  const facts = backupFacts("interim", [{ name: "shop", manifest: undefined }]);
  expect(serviceHasData).toHaveBeenCalledWith(undefined);
  expect(facts.services).toEqual({ shop: { hasData: true } });
});

test("with no service records the facts carry the kind and no services, and the has-data rule is not asked", () => {
  expect(backupFacts("off-host", [])).toEqual({
    targetKind: "off-host",
    services: {},
  });
  expect(serviceHasData).not.toHaveBeenCalled();
});

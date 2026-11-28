// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  externalDataErrors,
  type ExternalDataInput,
} from "./external-gateway-data.js";
import { serviceHasData } from "./service-data.js";

// The has-data rule is its own unit (service-data.spec.ts), so it is mocked here (ADR 0098);
// this spec tests only the gateway and kind conditions around it, and the real chain is in
// integration/config/external-gateway-data.spec.ts.
vi.mock("./service-data.js", () => ({ serviceHasData: vi.fn(() => true) }));

const file = "infra/environments/vps/services/leads.json";

/** A spec file for service leads, with the gateway field a test sets. */
function input(
  spec: Record<string, unknown>,
  backupKind: ExternalDataInput["backupKind"],
): ExternalDataInput {
  return {
    file,
    stem: "leads",
    manifest: {
      apiVersion: "platform.kore.dev/v1alpha1",
      kind: "Service",
      metadata: { name: "leads" },
      spec: { organization: "platform", environments: ["vps"], ...spec },
    },
    backupKind,
  };
}

beforeEach(() => {
  vi.mocked(serviceHasData).mockReset();
  vi.mocked(serviceHasData).mockReturnValue(true);
});

test("an external service the has-data rule counts as having data is refused while the target kind is interim", () => {
  const errors = externalDataErrors(
    input(
      { gateway: "external", databases: [{ name: "leads-db" }] },
      "interim",
    ),
  );
  expect(errors).toHaveLength(1);
});

test("the refusal names the service, the kind and the fix", () => {
  const [message] = externalDataErrors(
    input({ gateway: "external" }, "interim"),
  );
  expect(message).toContain(file);
  expect(message).toContain("leads");
  expect(message).toContain("interim");
  expect(message).toContain("off-host");
  expect(message).toContain("gateway to internal");
});

test("the has-data rule is asked about the service's own spec file", () => {
  const data = input({ gateway: "external" }, "interim");
  externalDataErrors(data);
  expect(serviceHasData).toHaveBeenCalledWith(data.manifest);
});

test("an external service is accepted once the target kind is off-host", () => {
  expect(
    externalDataErrors(input({ gateway: "external" }, "off-host")),
  ).toEqual([]);
});

test("an internal service is never refused, whatever the kind, and the has-data rule is not asked", () => {
  expect(externalDataErrors(input({ gateway: "internal" }, "interim"))).toEqual(
    [],
  );
  expect(serviceHasData).not.toHaveBeenCalled();
});

test("a service that does not name a gateway is internal by default and is never refused", () => {
  expect(externalDataErrors(input({}, "interim"))).toEqual([]);
});

test("an external service the has-data rule counts as having no data is never refused while the target kind is interim", () => {
  vi.mocked(serviceHasData).mockReturnValue(false);
  expect(externalDataErrors(input({ gateway: "external" }, "interim"))).toEqual(
    [],
  );
});

test("an external service is not refused when no target kind is declared, since there is no interim kind to refuse on", () => {
  expect(externalDataErrors(input({ gateway: "external" }, undefined))).toEqual(
    [],
  );
  expect(serviceHasData).not.toHaveBeenCalled();
});

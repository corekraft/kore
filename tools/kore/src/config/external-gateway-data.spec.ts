// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { expect, test } from "vitest";
import {
  externalDataErrors,
  type ExternalDataInput,
} from "./external-gateway-data.js";

const file = "infra/environments/vps/services/leads.json";

/** A spec file for service leads, with the gateway and data fields a test sets. */
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

const withData = {
  databases: [
    { name: "leads-db", version: 17, size: "10Gi", retentionPolicy: "Retain" },
  ],
};

test("an external service with data is refused while the target kind is interim", () => {
  const errors = externalDataErrors(
    input({ gateway: "external", ...withData }, "interim"),
  );
  expect(errors).toHaveLength(1);
});

test("the refusal names the service, the kind and the fix", () => {
  const [message] = externalDataErrors(
    input({ gateway: "external", ...withData }, "interim"),
  );
  expect(message).toContain(file);
  expect(message).toContain("leads");
  expect(message).toContain("interim");
  expect(message).toContain("off-host");
  expect(message).toContain("gateway to internal");
});

test("an external service with a declared secret name is refused while the target kind is interim", () => {
  const errors = externalDataErrors(
    input({ gateway: "external", secrets: ["leads-api-key"] }, "interim"),
  );
  expect(errors).toHaveLength(1);
});

test("an external service with data is accepted once the target kind is off-host", () => {
  expect(
    externalDataErrors(input({ gateway: "external", ...withData }, "off-host")),
  ).toEqual([]);
});

test("an internal service with data is never refused, whatever the kind", () => {
  expect(
    externalDataErrors(input({ gateway: "internal", ...withData }, "interim")),
  ).toEqual([]);
});

test("a service that does not name a gateway is internal by default and is never refused", () => {
  expect(externalDataErrors(input({ ...withData }, "interim"))).toEqual([]);
});

test("an external service with no data is never refused while the target kind is interim", () => {
  expect(externalDataErrors(input({ gateway: "external" }, "interim"))).toEqual(
    [],
  );
});

test("an external service is not refused when no target kind is declared, since there is no interim kind to refuse on", () => {
  expect(
    externalDataErrors(input({ gateway: "external", ...withData }, undefined)),
  ).toEqual([]);
});

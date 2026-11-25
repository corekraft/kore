import { expect, test } from "vitest";
import { healthyReadinessOutput } from "./app-fixtures.js";

const xrd =
  "compositeresourcedefinition.apiextensions.crossplane.io/services.platform.kore.dev";

test("an XRD read answers rendered, its condition observing its generation, so the XRD readiness check passes", () => {
  const read = JSON.parse(
    healthyReadinessOutput([xrd, "--output", "json"]) ?? "",
  );
  expect(read.status.conditions[0].observedGeneration).toBe(
    read.metadata.generation,
  );
});

test("a CRD read answers a CRD with no version, so the XRD readiness check finds no field missing", () => {
  expect(
    JSON.parse(
      healthyReadinessOutput([
        "crd/services.platform.kore.dev",
        "--output",
        "json",
      ]) ?? "",
    ),
  ).toEqual({ spec: { versions: [] } });
});

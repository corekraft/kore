import { expect, test } from "vitest";
import { ingressMeasurementDefaults } from "./ingress-measurement-types.js";

test("the defaults set no target rate, so the load stays closed-loop", () => {
  expect(ingressMeasurementDefaults).not.toHaveProperty(
    "targetRequestsPerSecond",
  );
});

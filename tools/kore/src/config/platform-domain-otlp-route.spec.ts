// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  otlpByName,
  otlpHostname,
  platformHelmArgs,
} from "./platform-domain.js";

const environment = (features: Record<string, boolean>) =>
  fakeEnvironment({
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
    features,
  });

test("the OTLP name is otlp under the platform organization, from the environment's platform field", () => {
  expect(otlpHostname(environment({}))).toBe("otlp.platform.kore.internal");
});

test("OTLP is reached by name only while the otlp-route flag is on", () => {
  expect(otlpByName(environment({ "otlp-route": true }))).toBe(true);
  expect(otlpByName(environment({ "otlp-route": false }))).toBe(false);
  expect(otlpByName(environment({}))).toBe(false);
});

test("with otlp-route on the OTLP route chart is handed its name and the shared Gateway it attaches to", () => {
  expect(
    platformHelmArgs(environment({ "otlp-route": true }), "kore-otlp-route"),
  ).toEqual([
    "--set-string",
    "otlpRoute.hostname=otlp.platform.kore.internal",
    "--set-string",
    "otlpRoute.gateway.name=kore-gateway",
    "--set-string",
    "otlpRoute.gateway.namespace=kore-system",
  ]);
});

test("with otlp-route off, and for any other component, no OTLP route argument is passed", () => {
  expect(
    platformHelmArgs(environment({ "otlp-route": false }), "kore-otlp-route"),
  ).toEqual([]);
  expect(
    platformHelmArgs(environment({ "otlp-route": true }), "otel-collector"),
  ).toEqual([]);
  expect(
    platformHelmArgs(environment({ "otlp-route": true }), "oci-registry"),
  ).toEqual([]);
});

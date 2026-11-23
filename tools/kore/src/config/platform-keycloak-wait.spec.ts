// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { keycloakWaitFlag } from "./features.js";
import { platformHelmArgs } from "./platform-domain.js";

const platform = {
  platform: { domain: "kore.internal", organizationId: "platform" },
};
const hosts = [
  "--set-string",
  "backstageHostname=backstage.kore.internal",
  "--set-string",
  "keycloakHostname=keycloak.kore.internal",
];

test("with platform-keycloak-wait on the portal is handed keycloakWait, so its pod waits for the Keycloak realm before the proxy starts", () => {
  const waitOn = fakeEnvironment({
    ...platform,
    features: { [keycloakWaitFlag]: true },
  });
  expect(platformHelmArgs(waitOn, "kore-platform-backstage")).toEqual([
    ...hosts,
    "--set",
    "keycloakWait=true",
  ]);
});

test("with platform-keycloak-wait on no other chart is handed keycloakWait", () => {
  const waitOn = fakeEnvironment({
    ...platform,
    features: { [keycloakWaitFlag]: true },
  });
  expect(platformHelmArgs(waitOn, "kore-platform-keycloak")).not.toContain(
    "keycloakWait=true",
  );
});

test("with platform-keycloak-wait off or omitted the portal is handed exactly the arguments it had before", () => {
  for (const environment of [
    fakeEnvironment({ ...platform, features: { [keycloakWaitFlag]: false } }),
    fakeEnvironment(platform),
  ]) {
    expect(platformHelmArgs(environment, "kore-platform-backstage")).toEqual(
      hosts,
    );
  }
});

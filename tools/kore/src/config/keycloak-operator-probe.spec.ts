// Docs: infra/catalog/compatibility.md (the Keycloak operator's startup probe, issue 2011)
import { expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { apiserverReadyFlag, featureEnabled } from "./features.js";
import { keycloakOperatorProbeHelmArgs } from "./keycloak-operator-probe.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  apiserverReadyFlag: "platform-apiserver-ready",
}));

const environment = fakeEnvironment();

test("with platform-apiserver-ready off the operator release gets no argument, so its render is as before", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    keycloakOperatorProbeHelmArgs(environment, "keycloak-operator"),
  ).toEqual([]);
  expect(featureEnabled).toHaveBeenCalledWith(environment, apiserverReadyFlag);
});

test("with platform-apiserver-ready on the operator release gets a startup probe allowance of 30 failures, 300 s at the probe's 10 s period", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(
    keycloakOperatorProbeHelmArgs(environment, "keycloak-operator"),
  ).toEqual(["--set", "operator.startupProbe.failureThreshold=30"]);
});

test("with platform-apiserver-ready on no other release gets the larger startup probe allowance", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(keycloakOperatorProbeHelmArgs(environment, "agentgateway")).toEqual(
    [],
  );
  expect(
    keycloakOperatorProbeHelmArgs(environment, "kore-platform-keycloak"),
  ).toEqual([]);
});

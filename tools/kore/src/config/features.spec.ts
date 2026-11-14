import { beforeEach, expect, test, vi } from "vitest";
import { orderedComponents } from "./order.js";
import {
  componentGatedOff,
  enabledComponents,
  featureEnabled,
  featureHelmArgs,
  gatewayClassName,
  ingressFlag,
} from "./features.js";
import type { Environment } from "./types.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
} from "./config-support.js";

vi.mock("./order.js");

/** An environment whose feature flags are the given map (a flag may hold any value). */
function environment(features?: Record<string, unknown>): Environment {
  return fakeEnvironment(
    features === undefined
      ? {}
      : { features: features as Record<string, boolean> },
  );
}

beforeEach(() => {
  vi.mocked(orderedComponents).mockReturnValue([]);
});

test("a flag is on only when the overlay sets it to true, and an omitted flag is off", () => {
  const flags = environment({ "agent-loop": true, quiet: false });
  expect(featureEnabled(flags, "agent-loop")).toBe(true);
  expect(featureEnabled(flags, "quiet")).toBe(false);
  expect(featureEnabled(flags, "absent")).toBe(false);
});

test("a flag holding the string true is not on, because only a boolean turns a flag on", () => {
  expect(
    featureEnabled(environment({ "agent-loop": "true" }), "agent-loop"),
  ).toBe(false);
  expect(featureEnabled(environment(undefined), "agent-loop")).toBe(false);
});

test("the Helm arguments hand every declared flag to the chart, sorted by name, as booleans", () => {
  expect(
    featureHelmArgs(environment({ quiet: false, "agent-loop": true })),
  ).toEqual([
    "--set",
    "features.agent-loop=true",
    "--set",
    "features.quiet=false",
  ]);
});

test("an environment with no features map passes no Helm arguments", () => {
  expect(featureHelmArgs(environment(undefined))).toEqual([]);
});

test("the ingress flag selects agentgateway as the GatewayClass, and its absence selects Istio", () => {
  expect(ingressFlag).toBe("ingress-agentgateway");
  expect(gatewayClassName(environment({ [ingressFlag]: true }))).toBe(
    "agentgateway",
  );
  expect(gatewayClassName(environment({ [ingressFlag]: false }))).toBe("istio");
  expect(gatewayClassName(environment(undefined))).toBe("istio");
});

test("a component with a feature flag is gated off while the flag is off, and on once it is on", () => {
  const gated = fakeComponent({ featureFlag: "agent-loop" });
  expect(componentGatedOff(environment({ "agent-loop": false }), gated)).toBe(
    true,
  );
  expect(componentGatedOff(environment({ "agent-loop": true }), gated)).toBe(
    false,
  );
});

test("a component with no feature flag is never gated off", () => {
  const plain = fakeComponent();
  expect(componentGatedOff(environment(undefined), plain)).toBe(false);
});

test("the enabled components are the catalog in dependency order, minus those a flag gates off", () => {
  const components = [
    fakeComponent({ name: "kore-registry" }),
    fakeComponent({ name: "agent-loop-app", featureFlag: "agent-loop" }),
    fakeComponent({ name: "kore-ui" }),
  ];
  vi.mocked(orderedComponents).mockReturnValue(components);
  const repository = fakeRepository({
    catalog: fakeCatalog(components),
    environment: environment({ "agent-loop": false }),
  });

  expect(enabledComponents(repository)).toEqual([components[0], components[2]]);
  expect(vi.mocked(orderedComponents).mock.calls).toEqual([
    [repository.catalog],
  ]);
});

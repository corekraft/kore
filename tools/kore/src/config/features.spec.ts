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
import type { Component, Environment, Repository } from "./types.js";

vi.mock("./order.js");

function environment(features?: Record<string, unknown>) {
  return { features } as unknown as Environment;
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
  const gated = { featureFlag: "agent-loop" } as Pick<Component, "featureFlag">;
  expect(componentGatedOff(environment({ "agent-loop": false }), gated)).toBe(
    true,
  );
  expect(componentGatedOff(environment({ "agent-loop": true }), gated)).toBe(
    false,
  );
});

test("a component with no feature flag is never gated off", () => {
  const plain = {} as Pick<Component, "featureFlag">;
  expect(componentGatedOff(environment(undefined), plain)).toBe(false);
});

test("the enabled components are the catalog in dependency order, minus those a flag gates off", () => {
  const components = [
    { name: "kore-registry" },
    { name: "agent-loop-app", featureFlag: "agent-loop" },
    { name: "kore-ui" },
  ] as unknown as Component[];
  vi.mocked(orderedComponents).mockReturnValue(components);
  const repository = {
    catalog: { components },
    environment: environment({ "agent-loop": false }),
  } as unknown as Repository;

  expect(enabledComponents(repository)).toEqual([
    { name: "kore-registry" },
    { name: "kore-ui" },
  ]);
  expect(vi.mocked(orderedComponents).mock.calls).toEqual([
    [repository.catalog],
  ]);
});

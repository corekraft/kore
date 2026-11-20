import { expect, test } from "vitest";
import { healthyClusterOutput } from "./platform-resilience.fixtures.js";

const read = (...args: string[]) => [
  "--context",
  "k3d-kore-local",
  "get",
  ...args,
];

test("a healthy cluster reports no Gateway class, as a fresh profile does, so no class change is attempted", () => {
  expect(
    healthyClusterOutput(
      read(
        "gateway/kore-gateway",
        "--output",
        "jsonpath={.spec.gatewayClassName}",
      ),
    ),
  ).toBe("");
});

test.each([
  ["gateway/kore-gateway"],
  ["deployment/kore-gateway-istio"],
  ["service/kore-gateway-istio"],
  [
    "deployment,service",
    "--selector",
    "gateway.networking.k8s.io/gateway-name=kore-gateway",
  ],
])("a healthy cluster has no leftover %s to wait for", (...resource) => {
  expect(
    healthyClusterOutput(
      read(...resource, "--ignore-not-found", "--output", "name"),
    ),
  ).toBe("");
});

test("a healthy cluster answers an HTTPRoute read with its parent Accepted and ResolvedRefs true, so a route's readiness passes", () => {
  expect(
    JSON.parse(healthyClusterOutput(read("httproute/otlp", "--output", "json")))
      .status.parents,
  ).toEqual([
    {
      conditions: [
        { type: "Accepted", status: "True" },
        { type: "ResolvedRefs", status: "True" },
      ],
    },
  ]);
});

test("a Gateway status read still answers the healthy conditions", () => {
  expect(
    JSON.parse(
      healthyClusterOutput(read("gateway/kore-gateway", "--output", "json")),
    ).status.conditions,
  ).toEqual([
    { type: "Accepted", status: "True" },
    { type: "Programmed", status: "True" },
  ]);
});

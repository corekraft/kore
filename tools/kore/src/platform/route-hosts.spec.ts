// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import { expect, test } from "vitest";
import { hostMatchesListener, routeHostErrors } from "./route-hosts.js";

const gateway = { namespace: "kore-system", name: "kore-gateway" };

function platformGateway(...hostnames: string[]): string {
  return [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: Gateway",
    "metadata:",
    "  name: kore-gateway",
    "  namespace: kore-system",
    "spec:",
    "  listeners:",
    ...hostnames.flatMap((hostname, index) => [
      `    - name: https${index}`,
      `      hostname: ${JSON.stringify(hostname)}`,
      "      port: 8443",
      "      protocol: HTTPS",
    ]),
  ].join("\n");
}

function route(
  parent: string,
  hosts: string[],
  name = "reference",
  namespace = "reference",
): string {
  return [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: HTTPRoute",
    "metadata:",
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    "spec:",
    "  parentRefs:",
    `    - {name: ${parent}, namespace: kore-system}`,
    `  hostnames: [${hosts.map((host) => JSON.stringify(host)).join(", ")}]`,
    "  rules:",
    "    - backendRefs: [{name: web, port: 80}]",
  ].join("\n");
}

const join = (...documents: string[]) => documents.join("\n---\n");

test("an exact host matches an exact listener hostname, and a different host does not", () => {
  expect(hostMatchesListener("kore.internal", "kore.internal")).toBe(true);
  expect(hostMatchesListener("kore.example", "kore.internal")).toBe(false);
});

test("matching ignores case", () => {
  expect(hostMatchesListener("Kore.Internal", "kore.internal")).toBe(true);
});

test("a wildcard listener matches hosts below it, never its own apex", () => {
  expect(
    hostMatchesListener(
      "web.platform.kore.internal",
      "*.platform.kore.internal",
    ),
  ).toBe(true);
  expect(
    hostMatchesListener("platform.kore.internal", "*.platform.kore.internal"),
  ).toBe(false);
  expect(
    hostMatchesListener("web.other.kore.internal", "*.platform.kore.internal"),
  ).toBe(false);
});

test("a route host the platform Gateway lists produces no error", () => {
  expect(
    routeHostErrors(
      join(
        platformGateway("kore.internal"),
        route("kore-gateway", ["kore.internal"]),
      ),
      gateway,
    ),
  ).toEqual([]);
});

test("a route host no listener hostname matches is named with the Gateway's listeners and the fix", () => {
  expect(
    routeHostErrors(
      join(
        platformGateway("kore.internal"),
        route("kore-gateway", ["moved.example"]),
      ),
      gateway,
    ),
  ).toEqual([
    "HTTPRoute reference/reference host moved.example matches no listener hostname of Gateway kore-system/kore-gateway (listeners: kore.internal); add a listener for the host or derive the host from platform.domain",
  ]);
});

test("each unmatched host of a route is its own error, and a matched one is not reported", () => {
  expect(
    routeHostErrors(
      join(
        platformGateway("kore.internal"),
        route("kore-gateway", [
          "kore.internal",
          "a.kore.internal",
          "b.kore.internal",
        ]),
      ),
      gateway,
    ),
  ).toHaveLength(2);
});

test("a route attached to another Gateway is not held to the platform Gateway's listeners", () => {
  expect(
    routeHostErrors(
      join(
        platformGateway("kore.internal"),
        route("backstage", ["backstage.kore.internal"]),
      ),
      gateway,
    ),
  ).toEqual([]);
});

test("a route that lists no hostnames produces no error", () => {
  const bare = route("kore-gateway", []).replace(/^ {2}hostnames:.*\n/m, "");
  expect(
    routeHostErrors(join(platformGateway("kore.internal"), bare), gateway),
  ).toEqual([]);
});

test("hostnames written as a block list are read", () => {
  const block = [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: HTTPRoute",
    "metadata:",
    "  name: portal",
    "  namespace: portal",
    "spec:",
    "  parentRefs:",
    "    - kind: Gateway",
    "      name: kore-gateway",
    "  hostnames:",
    '    - "portal.kore.internal"',
    "  rules:",
    "    - backendRefs: [{name: web, port: 80}]",
  ].join("\n");
  expect(
    routeHostErrors(join(platformGateway("kore.internal"), block), gateway),
  ).toEqual([
    "HTTPRoute portal/portal host portal.kore.internal matches no listener hostname of Gateway kore-system/kore-gateway (listeners: kore.internal); add a listener for the host or derive the host from platform.domain",
  ]);
});

test("a rendering with no platform Gateway is refused, so a missing Gateway never passes as zero errors", () => {
  expect(
    routeHostErrors(route("kore-gateway", ["kore.internal"]), gateway),
  ).toEqual([
    "no Gateway kore-system/kore-gateway in the rendered output; render the platform config chart beside the routes",
  ]);
});

test("a wildcard listener alongside the apex covers both", () => {
  expect(
    routeHostErrors(
      join(
        platformGateway("kore.internal", "*.platform.kore.internal"),
        route("kore-gateway", ["kore.internal", "web.platform.kore.internal"]),
      ),
      gateway,
    ),
  ).toEqual([]);
});

test("a route whose metadata is written in flow style is still named in the error", () => {
  const flow = [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: HTTPRoute",
    "metadata: {name: reference}",
    "spec:",
    "  parentRefs:",
    "    - {name: kore-gateway, namespace: kore-system }",
    '  hostnames: ["moved.example"]',
  ].join("\n");
  expect(
    routeHostErrors(join(platformGateway("kore.internal"), flow), gateway),
  ).toEqual([
    "HTTPRoute reference host moved.example matches no listener hostname of Gateway kore-system/kore-gateway (listeners: kore.internal); add a listener for the host or derive the host from platform.domain",
  ]);
});

import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import { render } from "./gateway-service-support.js";

// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md
// Spec #1612, issue 1674: one platform-owned AgentgatewayPolicy limits the external Gateway. Its numbers come
// from the environment's values, never from an app record, and Override keeps any route policy from loosening it.

const limitFlags = {
  "ingress-agentgateway": true,
  "platform-shared-gateway": true,
  "service-listener-sets": true,
  "external-gateway": true,
  "external-gateway-limits": true,
};

/** The repository with the given flags set, the rest as the overlay has them. */
function withFeatures(
  repository: Repository,
  features: Record<string, boolean>,
): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, ...features },
    },
  };
}

/** The AgentgatewayPolicy documents in a render, each without its Helm source comment. */
function policies(output: string): string[] {
  return output
    .split(/^---$/m)
    .filter((document) => /^kind: AgentgatewayPolicy$/m.test(document))
    .map((document) =>
      document
        .split("\n")
        .filter((line) => !line.startsWith("# Source:"))
        .join("\n")
        .trim(),
    );
}

const expectedPolicy = `apiVersion: agentgateway.dev/v1alpha1
kind: AgentgatewayPolicy
metadata:
  name: kore-gateway-external-limits
  namespace: kore-system
  labels: {app.kubernetes.io/managed-by: Helm}
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: Gateway
      name: kore-gateway-external
  strategy:
    inheritance: Override
  frontend:
    http:
      maxConcurrentRequests: 256
      http1MaxHeaders: 100
      http2MaxHeaderSize: 16Ki
  traffic:
    buffer:
      request:
        maxBytes: 1048576
        failureMode: FailClosed
    rateLimit:
      local:
        - requests: 200
          unit: Seconds
          burst: 100
    timeouts:
      request: 60s
      responseIdle: 30s`;

/** The render with extra helm arguments, which a missing or invalid value is set by. */
function renderWith(repository: Repository, extra: string[]): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
  return execFileSync(
    "helm",
    [
      ...withAbsoluteChart(
        repository,
        component,
        helmTemplateArgs(repository, component),
      ),
      ...extra,
    ],
    {
      cwd: repository.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

test("with both flags on, vps renders exactly one AgentgatewayPolicy: Override on the external Gateway, with the overlay's numbers", async () => {
  const output = render(withFeatures(await loadRepository("vps"), limitFlags));
  expect(policies(output)).toEqual([expectedPolicy]);
});

test("with external-gateway-limits off nothing of the policy renders, whatever the other flags", async () => {
  const output = render(
    withFeatures(await loadRepository("vps"), {
      ...limitFlags,
      "external-gateway-limits": false,
    }),
  );
  expect(policies(output)).toEqual([]);
  expect(output).not.toMatch(/kind: AgentgatewayPolicy/);
});

test("with external-gateway off the policy does not render, though its limits flag is on, because there is no external Gateway to limit", async () => {
  const output = render(
    withFeatures(await loadRepository("vps"), {
      ...limitFlags,
      "external-gateway": false,
    }),
  );
  expect(policies(output)).toEqual([]);
});

test("no render carries a policy for the internal Gateway or a route-level policy", async () => {
  const output = render(withFeatures(await loadRepository("vps"), limitFlags));
  const targets = policies(output).flatMap((document) =>
    [...document.matchAll(/name: (\S+)$/gm)].map((match) => match[1]),
  );
  expect(targets.filter((name) => name === "kore-gateway")).toEqual([]);
  expect(output.match(/kind: AgentgatewayPolicy/g)).toHaveLength(1);
});

test("the policy is an agentgateway resource: with ingress-agentgateway off the render refuses, naming the flag", async () => {
  const repository = withFeatures(await loadRepository("vps"), {
    ...limitFlags,
    "ingress-agentgateway": false,
  });
  expect(() => renderWith(repository, [])).toThrow(
    /external-gateway-limits needs ingress-agentgateway: its policy is an AgentgatewayPolicy/,
  );
});

test.each([
  ["externalGateway.limits.concurrentRequests", "concurrentRequests"],
  ["externalGateway.limits.rate.requests", "rate.requests"],
  ["externalGateway.limits.body.maxBytes", "body.maxBytes"],
  ["externalGateway.limits.headers.http1MaxHeaders", "headers.http1MaxHeaders"],
  ["externalGateway.limits.timeouts.request", "timeouts.request"],
])(
  "a missing %s in the overlay fails the render, naming the field",
  async (path, field) => {
    const repository = withFeatures(await loadRepository("vps"), limitFlags);
    expect(() => renderWith(repository, ["--set", `${path}=null`])).toThrow(
      new RegExp(`externalGateway\\.limits\\.${field.replace(/\./g, "\\.")} `),
    );
  },
);

test.each([
  ["externalGateway.limits.concurrentRequests", "concurrentRequests"],
  ["externalGateway.limits.rate.requests", "rate.requests"],
  ["externalGateway.limits.body.maxBytes", "body.maxBytes"],
  ["externalGateway.limits.headers.http1MaxHeaders", "headers.http1MaxHeaders"],
])(
  "a non-positive %s in the overlay fails the render, naming the field",
  async (path, field) => {
    const repository = withFeatures(await loadRepository("vps"), limitFlags);
    expect(() => renderWith(repository, ["--set", `${path}=0`])).toThrow(
      new RegExp(`externalGateway\\.limits\\.${field.replace(/\./g, "\\.")} `),
    );
  },
);

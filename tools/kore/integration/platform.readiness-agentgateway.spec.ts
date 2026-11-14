import assert from "node:assert/strict";
import { test } from "vitest";
import { ingressFlag, loadRepository } from "../src/config/index.js";
import type { Repository } from "../src/config/index.js";
import type { Runner } from "../src/runtime/index.js";
import { gatewayCheck, waitForGateway } from "../src/platform/readiness-gateway.js";

const ready = { status: "True" };

interface Cluster {
  /** Names the Istio ingress proxy still has in the cluster. */
  istioProxy?: ("deployment" | "service")[];
  gatewayClass?: object;
  gateway?: object;
}

const acceptedGateway = {
  status: {
    conditions: [
      { type: "Accepted", ...ready },
      { type: "Programmed", ...ready },
    ],
    listeners: [
      { name: "https", conditions: [{ type: "ResolvedRefs", ...ready }] },
    ],
  },
};
const publishedService = {
  items: [{ status: { loadBalancer: { ingress: [{ ip: "127.0.0.1" }] } } }],
};

async function repositoryWith(on: boolean): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: { ...base.environment, features: { [ingressFlag]: on } },
  };
}

function cluster({
  istioProxy = [],
  gatewayClass = { status: { conditions: [{ type: "Accepted", ...ready }] } },
  gateway = acceptedGateway,
}: Cluster = {}) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(_command, args) {
      calls.push([...args]);
      const named = (kind: string) =>
        args.includes(`${kind}/kore-gateway-istio`);
      let stdout = "";
      if (named("deployment")) {
        stdout = istioProxy.includes("deployment")
          ? "deployment.apps/kore-gateway-istio"
          : "";
      } else if (named("service")) {
        stdout = istioProxy.includes("service")
          ? "service/kore-gateway-istio"
          : "";
      } else if (args.includes("gatewayclass/agentgateway")) {
        stdout = JSON.stringify(gatewayClass);
      } else if (args.includes("service")) {
        stdout = JSON.stringify(publishedService);
      } else if (args.includes("gateway/kore-gateway")) {
        stdout = JSON.stringify(gateway);
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

const base = ["--context", "kore-local", "--namespace", "kore-system"];

test("with the ingress flag on, the Gateway is not ready while the Istio ingress proxy Deployment remains", async () => {
  const repository = await repositoryWith(true);
  const { runner } = cluster({ istioProxy: ["deployment"] });
  await assert.rejects(
    waitForGateway(repository, runner, base, "gateway/kore-gateway", "1s"),
    /Istio ingress proxy.*deployment\/kore-gateway-istio.*still exists/s,
  );
});

test("with the ingress flag on, the Gateway is not ready while the Istio ingress proxy Service remains", async () => {
  const repository = await repositoryWith(true);
  const { runner } = cluster({ istioProxy: ["service"] });
  await assert.rejects(
    waitForGateway(repository, runner, base, "gateway/kore-gateway", "1s"),
    /Istio ingress proxy.*service\/kore-gateway-istio.*still exists/s,
  );
});

test("with the ingress flag on, a Gateway with no Istio ingress proxy is ready", async () => {
  const repository = await repositoryWith(true);
  const { runner } = cluster();
  await waitForGateway(repository, runner, base, "gateway/kore-gateway", "5s");
});

test("with the ingress flag off, readiness never looks for the Istio ingress proxy", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster({ istioProxy: ["deployment", "service"] });
  await waitForGateway(repository, runner, base, "gateway/kore-gateway", "5s");
  assert.equal(
    calls.some((args) => args.includes("kore-gateway-istio")),
    false,
  );
});

test("a GatewayClass agentgateway has not accepted fails fast naming agentgateway's reason", async () => {
  const repository = await repositoryWith(true);
  const { runner } = cluster({
    gatewayClass: {
      status: {
        conditions: [
          {
            type: "Accepted",
            status: "False",
            reason: "InvalidParameters",
            message: "controller is not running",
          },
        ],
      },
    },
  });
  await assert.rejects(
    waitForGateway(repository, runner, base, "gateway/kore-gateway", "1s"),
    /agentgateway.*GatewayClass.*Accepted is False \(reason: InvalidParameters\): controller is not running/s,
  );
});

test("a Gateway agentgateway rejects names agentgateway and the condition reason", async () => {
  const repository = await repositoryWith(true);
  const { runner } = cluster({
    gateway: {
      status: {
        conditions: [
          {
            type: "Accepted",
            status: "False",
            reason: "ListenersNotValid",
          },
        ],
      },
    },
  });
  await assert.rejects(
    waitForGateway(repository, runner, base, "gateway/kore-gateway", "1s"),
    /agentgateway.*Accepted is False \(reason: ListenersNotValid\)/s,
  );
});

test("a leftover Istio ingress proxy fails with the command that removes it", async () => {
  const repository = await repositoryWith(true);
  const { runner } = cluster({ istioProxy: ["deployment"] });
  await assert.rejects(
    waitForGateway(repository, runner, base, "gateway/kore-gateway", "1s"),
    /kubectl --context kore-local --namespace kore-system delete deployment\/kore-gateway-istio/,
  );
});

async function conditionWith(on: boolean): Promise<string> {
  const repository = await repositoryWith(on);
  const { runner } = cluster();
  return gatewayCheck({ repository, runner, base }, "gateway/kore-gateway")!
    .condition;
}

test("the Gateway readiness condition names the GatewayClass and Istio proxy checks only with the flag on", async () => {
  assert.match(await conditionWith(true), /Istio ingress proxy.*GatewayClass/s);
  assert.doesNotMatch(await conditionWith(false), /GatewayClass|Istio/);
});

test("turning the flag back off needs no agentgateway or Istio proxy check", async () => {
  const repository = await repositoryWith(false);
  const { runner, calls } = cluster();
  await waitForGateway(repository, runner, base, "gateway/kore-gateway", "5s");
  assert.equal(
    calls.some((args) => args.some((a) => /agentgateway|istio/.test(a))),
    false,
  );
});

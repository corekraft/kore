import { loadRepository } from "../config/index.js";
import assert from "node:assert/strict";
import { test } from "vitest";

import type { Runner } from "../runtime/index.js";
import { reconcileComponent } from "./reconcile.js";

type Handler = (args: readonly string[]) => string;
interface Call {
  command: string;
  args: readonly string[];
}

function fakeCluster(handler: Handler): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return {
        stdout: command === "kubectl" ? handler(args) : "",
        stderr: "",
        code: 0,
      };
    },
  };
  return { runner, calls };
}

async function helmComponent(readiness: string[]) {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  return {
    repository,
    component: { ...component, readiness, ownsCRDs: [], timeout: "1s" },
  };
}

function condition(type: string, status = "True", reason = type) {
  return { type, status, reason, message: `${type} is ${status}` };
}

function gatewayJson(
  options: {
    accepted?: string;
    programmed?: string;
    programmedReason?: string;
    listenerStatus?: string;
    listenerReason?: string;
  } = {},
): string {
  return JSON.stringify({
    status: {
      conditions: [
        condition("Accepted", options.accepted),
        condition(
          "Programmed",
          options.programmed,
          options.programmedReason ?? "Programmed",
        ),
      ],
      listeners: [
        {
          name: "https",
          conditions: [
            condition(
              "ResolvedRefs",
              options.listenerStatus,
              options.listenerReason ?? "ResolvedRefs",
            ),
          ],
        },
      ],
    },
  });
}

function serviceJson(address: boolean): string {
  return JSON.stringify({
    items: [
      {
        status: {
          loadBalancer: address ? { ingress: [{ ip: "127.0.0.1" }] } : {},
        },
      },
    ],
  });
}

function gatewayCluster(
  gateway: string,
  hasAddress = true,
): ReturnType<typeof fakeCluster> {
  return fakeCluster((args) => {
    if (args.includes("service")) {
      return serviceJson(hasAddress);
    }
    return gateway;
  });
}

test("a Gateway is ready only after its Service address, Accepted, Programmed and listener ResolvedRefs all hold", async () => {
  const { repository, component } = await helmComponent(["gateway/edge"]);
  const { runner, calls } = gatewayCluster(gatewayJson());

  await reconcileComponent(repository, runner, component);

  const kubectl = calls.filter(({ command }) => command === "kubectl");
  assert.ok(
    kubectl.some(({ args }) => args.includes("service")),
    "the Gateway Service is inspected for a LoadBalancer address",
  );
  assert.ok(kubectl.every(({ args }) => args.includes("get")));
});

test("a Gateway without a LoadBalancer address fails naming AddressNotAssigned", async () => {
  const { repository, component } = await helmComponent(["gateway/edge"]);
  const { runner } = gatewayCluster(
    gatewayJson({
      programmed: "False",
      programmedReason: "AddressNotAssigned",
    }),
    false,
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /component .* failed to become ready: gateway\/edge .*LoadBalancer address.*AddressNotAssigned/s,
  );
});

test("a Gateway that is not Accepted fails naming the condition and reason", async () => {
  const { repository, component } = await helmComponent(["gateway/edge"]);
  const { runner } = gatewayCluster(
    gatewayJson({ accepted: "False", programmedReason: "Pending" }),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /gateway\/edge .*Accepted/,
  );
});

test("a Gateway listener with an invalid certificate reference fails naming InvalidCertificateRef", async () => {
  const { repository, component } = await helmComponent(["gateway/edge"]);
  const { runner } = gatewayCluster(
    gatewayJson({
      listenerStatus: "False",
      listenerReason: "InvalidCertificateRef",
    }),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /gateway\/edge .*listener https ResolvedRefs.*InvalidCertificateRef/s,
  );
});

test("a readiness timeout names the component, the resource and the condition", async () => {
  const { repository, component } = await helmComponent(["deployment/web"]);
  const runner: Runner = {
    async run(command, args) {
      if (command === "kubectl" && args.includes("rollout")) {
        throw new Error("timed out waiting for the condition");
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    new RegExp(
      `component ${component.name} failed to become ready: deployment/web .*rollout.*timed out waiting for the condition`,
    ),
  );
});

const issuerMissing =
  'Error from server (NotFound): clusterissuers.cert-manager.io "kore-local-ca" not found';

function trustCluster(options: { issuer: boolean; caSecret: boolean }) {
  return fakeCluster((args) => {
    const text = args.join(" ");
    if (text.includes("certificate/edge-cert") && text.includes("jsonpath")) {
      return "ClusterIssuer/kore-local-ca";
    }
    if (text.includes("clusterissuer/kore-local-ca")) {
      if (!options.issuer) {
        throw new Error(issuerMissing);
      }
      return "kore-local-ca-key-pair";
    }
    if (text.includes("secret/kore-local-ca-key-pair")) {
      if (!options.caSecret) {
        throw new Error('secrets "kore-local-ca-key-pair" not found');
      }
      return "secret/kore-local-ca-key-pair";
    }
    if (text.includes("secret/edge-tls")) {
      throw new Error('secrets "edge-tls" not found');
    }
    return "";
  });
}

test("a missing ClusterIssuer fails fast with the trust install command instead of timing out", async () => {
  const { repository, component } = await helmComponent([
    "certificate/edge-cert",
  ]);
  const { runner, calls } = trustCluster({ issuer: false, caSecret: false });

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /ClusterIssuer kore-local-ca is missing.*kore trust install --environment local/s,
  );
  assert.ok(
    !calls.some(({ args }) => args.includes("wait")),
    "no wait starts once the issuer is known to be missing",
  );
});

test("a missing CA Secret fails with the trust install command", async () => {
  const { repository, component } = await helmComponent([
    "certificate/edge-cert",
  ]);
  const { runner } = trustCluster({ issuer: true, caSecret: false });

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /CA Secret cert-manager\/kore-local-ca-key-pair .*missing.*kore trust install --environment local/s,
  );
});

test("a missing TLS Secret names the Secret and points at trust install", async () => {
  const { repository, component } = await helmComponent(["secret/edge-tls"]);
  const { runner } = trustCluster({ issuer: true, caSecret: true });

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /secret\/edge-tls .*complete TLS Secret.*kore trust install --environment local/s,
  );
});

test("a ConfigMap readiness entry is proven by existence, not by a rollout", async () => {
  const { repository, component } = await helmComponent([
    "configmap/kore-prometheus-rules",
  ]);
  const { runner, calls } = fakeCluster(
    () => "configmap/kore-prometheus-rules",
  );

  await reconcileComponent(repository, runner, component);

  const kubectl = calls.filter(({ command }) => command === "kubectl");
  assert.ok(
    kubectl.some(
      ({ args }) =>
        args.includes("get") &&
        args.includes("configmap/kore-prometheus-rules"),
    ),
  );
  assert.ok(kubectl.every(({ args }) => !args.includes("rollout")));
});

test("a Crossplane Function is ready only after it is Installed and then Healthy", async () => {
  const { repository, component } = await helmComponent([
    "function.pkg.crossplane.io/function-auto-ready",
  ]);
  const { runner, calls } = fakeCluster(() => "");

  await reconcileComponent(repository, runner, component);

  const waits = calls
    .filter(({ command }) => command === "kubectl")
    .map(({ args }) => args.join(" "))
    .filter((call) => call.includes(" wait "));
  assert.equal(waits.length, 2);
  assert.match(
    waits[0]!,
    /wait --for=condition=Installed function\.pkg\.crossplane\.io\/function-auto-ready --timeout=1s/,
  );
  assert.match(
    waits[1]!,
    /wait --for=condition=Healthy function\.pkg\.crossplane\.io\/function-auto-ready --timeout=1s/,
  );
  assert.ok(
    calls.every(({ args }) => !args.includes("rollout")),
    "a Function is not a workload with a rollout",
  );
});

test("a Function that never becomes Healthy fails naming the Function and condition", async () => {
  const { repository, component } = await helmComponent([
    "function.pkg.crossplane.io/function-go-templating",
  ]);
  const { runner } = {
    runner: {
      async run(command: string, args: readonly string[]) {
        if (args.includes("--for=condition=Healthy")) {
          throw new Error("timed out waiting for the condition on functions");
        }
        return { stdout: "", stderr: "", code: 0 };
      },
    } as Runner,
  };

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /function\.pkg\.crossplane\.io\/function-go-templating not ready \(Installed and Healthy\) within 1s: .*timed out/s,
  );
});

test("a Function that is not yet created is retried until it appears", async () => {
  const { repository, component } = await helmComponent([
    "function.pkg.crossplane.io/function-auto-ready",
  ]);
  let installedWaits = 0;
  const runner: Runner = {
    async run(_command, args) {
      if (args.includes("--for=condition=Installed")) {
        installedWaits++;
        if (installedWaits === 1) {
          throw new Error('functions.pkg.crossplane.io "x" not found');
        }
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await reconcileComponent(repository, runner, component);
  assert.equal(installedWaits, 2);
});

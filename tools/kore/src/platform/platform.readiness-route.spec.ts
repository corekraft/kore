import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { reconcileComponent } from "./reconcile.js";

interface Call {
  command: string;
  args: readonly string[];
}

const ready = { status: "True" };
const gateway = JSON.stringify({
  status: {
    conditions: [
      { type: "Accepted", ...ready },
      { type: "Programmed", ...ready },
    ],
    listeners: [
      { name: "https", conditions: [{ type: "ResolvedRefs", ...ready }] },
    ],
  },
});
const service = JSON.stringify({
  items: [{ status: { loadBalancer: { ingress: [{ ip: "127.0.0.1" }] } } }],
});

function route(conditions: object[] | undefined): string {
  return JSON.stringify({
    status: conditions ? { parents: [{ conditions }] } : {},
  });
}

const nodePortService = JSON.stringify({
  items: [
    {
      spec: { type: "NodePort", ports: [{ port: 8443, nodePort: 30443 }] },
      status: { loadBalancer: {} },
    },
  ],
});

function cluster(
  routeJson: string,
  hasAddress = true,
  serviceJson: string = service,
) {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      let stdout = "";
      if (command === "kubectl") {
        if (args.includes("httproute/web")) {
          stdout = routeJson;
        } else if (args.includes("service")) {
          stdout = hasAddress ? serviceJson : JSON.stringify({ items: [] });
        } else if (args.includes("gateway/edge")) {
          stdout = gateway;
        }
      }
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

async function component() {
  const repository = await loadRepository("local");
  const base = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  return {
    repository,
    component: {
      ...base,
      readiness: ["gateway/edge", "httproute/web"],
      ownsCRDs: [],
      timeout: "1s",
    },
  };
}

test("an HTTPRoute is ready only after the Gateway address and the route's Accepted and ResolvedRefs hold", async () => {
  const { repository, component: c } = await component();
  const { runner, calls } = cluster(
    route([
      { type: "Accepted", ...ready },
      { type: "ResolvedRefs", ...ready },
    ]),
  );

  await reconcileComponent(repository, runner, c);

  const kubectl = calls.filter(({ command }) => command === "kubectl");
  const address = kubectl.findIndex(({ args }) => args.includes("service"));
  const routeRead = kubectl.findIndex(({ args }) =>
    args.includes("httproute/web"),
  );
  assert.ok(address >= 0 && routeRead > address);
  assert.ok(kubectl.every(({ args }) => args.includes("get")));
});

test("a route whose backend does not resolve fails naming the route and ResolvedRefs", async () => {
  const { repository, component: c } = await component();
  const { runner } = cluster(
    route([
      { type: "Accepted", ...ready },
      { type: "ResolvedRefs", status: "False", reason: "BackendNotFound" },
    ]),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, c),
    /httproute\/web .*ResolvedRefs is False \(reason: BackendNotFound\)/s,
  );
});

test("a route no controller has reported on fails naming the route, not a bare timeout", async () => {
  const { repository, component: c } = await component();
  const { runner } = cluster(route(undefined));

  await assert.rejects(
    reconcileComponent(repository, runner, c),
    /httproute\/web .*no parent status yet/s,
  );
});

test("a missing Gateway address stops the bootstrap before any route is read", async () => {
  const { repository, component: c } = await component();
  const { runner, calls } = cluster(route([]), false);

  await assert.rejects(
    reconcileComponent(repository, runner, c),
    /gateway\/edge .*LoadBalancer address/s,
  );
  assert.ok(!calls.some(({ args }) => args.includes("httproute/web")));
});

test("a NodePort Gateway Service counts as published once its node port is assigned, with no LoadBalancer address", async () => {
  const { repository, component: c } = await component();
  const { runner } = cluster(
    route([
      { type: "Accepted", ...ready },
      { type: "ResolvedRefs", ...ready },
    ]),
    true,
    nodePortService,
  );

  await reconcileComponent(repository, runner, c);
});

test("a NodePort Service without an assigned node port is not published", async () => {
  const { repository, component: c } = await component();
  const { runner } = cluster(
    route([]),
    true,
    JSON.stringify({
      items: [{ spec: { type: "NodePort", ports: [{ port: 8443 }] } }],
    }),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, c),
    /gateway\/edge .*LoadBalancer address or node port/s,
  );
});

test("a NodePort Service on a different node port than configured is not published, and both ports are reported", async () => {
  const { repository, component: c } = await component();
  const { runner } = cluster(
    route([]),
    true,
    JSON.stringify({
      items: [
        {
          spec: { type: "NodePort", ports: [{ port: 8443, nodePort: 31111 }] },
        },
      ],
    }),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, c),
    /gateway\/edge .*node port 31111.*configured node port 30443/s,
  );
});

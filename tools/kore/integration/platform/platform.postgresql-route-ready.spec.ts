import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chart,
  databaseRoutes,
  inlineTemplate,
  kind,
  renderStep,
} from "./platform.postgresql-chart-support.js";

// Docs: docs/decisions/0139-each-database-gets-a-tls-route-in-its-own-namespace-for-postgres-17-and-18-behind-database-routes.md
// With database-routes on, a database's TLS route is ready only once the observed
// route has Accepted and ResolvedRefs True for the shared Gateway (issue 1472). A
// route the Gateway refused stays unready, and the claim projects the reason.
// Rendered offline with helm and the Go template engine function-go-templating uses.

const gateway = { name: "kore-gateway", namespace: "kore-system" };

function condition(type: string, status: string, reason: string, message = "") {
  return { type, status, reason, message };
}

function routeStatus(
  conditions: object[],
  parent: { name: string; namespace: string } = gateway,
) {
  return {
    parents: [
      {
        parentRef: {
          group: "gateway.networking.k8s.io",
          kind: "Gateway",
          name: parent.name,
          namespace: parent.namespace,
          sectionName: "postgres",
        },
        controllerName: "gateway.example.com/controller",
        conditions,
      },
    ],
  };
}

const accepted = routeStatus([
  condition("Accepted", "True", "Accepted"),
  condition("ResolvedRefs", "True", "ResolvedRefs"),
]);

async function tlsRoute(version: number, status?: object): Promise<string> {
  const template = inlineTemplate(
    await chart(...databaseRoutes),
    "compose-cloudnative-pg",
  );
  return (
    kind(await renderStep(template, version, undefined, status), "TLSRoute") ??
    ""
  );
}

async function projectedStatus(
  version: number,
  status?: object,
  database?: object,
): Promise<string> {
  const template = inlineTemplate(
    await chart(...databaseRoutes),
    "project-status",
  );
  return await renderStep(template, version, database, status);
}

test("with database-routes on, the TLS route is ready once the Gateway accepts it and resolves its references", async () => {
  const route = await tlsRoute(17, accepted);
  assert.match(route, /^ {4}gotemplating\.fn\.crossplane\.io\/ready: "True"$/m);
});

test("with database-routes on, the TLS route stays unready when the Gateway refuses it", async () => {
  const route = await tlsRoute(
    17,
    routeStatus([
      condition(
        "Accepted",
        "False",
        "NotAllowedByListeners",
        "listener postgres refuses this namespace",
      ),
      condition("ResolvedRefs", "True", "ResolvedRefs"),
    ]),
  );
  assert.match(
    route,
    /^ {4}gotemplating\.fn\.crossplane\.io\/ready: "False"$/m,
  );
});

test("with database-routes on, the TLS route stays unready when the Gateway cannot resolve its references", async () => {
  const route = await tlsRoute(
    18,
    routeStatus([
      condition("Accepted", "True", "Accepted"),
      condition("ResolvedRefs", "False", "BackendNotFound"),
    ]),
  );
  assert.match(
    route,
    /^ {4}gotemplating\.fn\.crossplane\.io\/ready: "False"$/m,
  );
});

test("with database-routes on, the TLS route stays unready until the route is observed", async () => {
  const route = await tlsRoute(17);
  assert.match(
    route,
    /^ {4}gotemplating\.fn\.crossplane\.io\/ready: "False"$/m,
  );
});

test("with database-routes on, a route accepted by another Gateway does not make this database's route ready", async () => {
  const route = await tlsRoute(
    17,
    routeStatus(
      [
        condition("Accepted", "True", "Accepted"),
        condition("ResolvedRefs", "True", "ResolvedRefs"),
      ],
      { name: "other-gateway", namespace: "kore-system" },
    ),
  );
  assert.match(
    route,
    /^ {4}gotemplating\.fn\.crossplane\.io\/ready: "False"$/m,
  );
});

test("with database-routes on, an accepted route projects a True DatabaseRouteReady condition with reason Routed", async () => {
  const out = await projectedStatus(17, accepted, {
    phase: "Cluster in healthy state",
  });
  assert.match(
    out,
    /- type: DatabaseRouteReady\n {4}status: "True"\n {4}reason: "Routed"/,
  );
});

test("with database-routes on, a route the Gateway refused projects a False DatabaseRouteReady condition with the Gateway's reason and message", async () => {
  const out = await projectedStatus(
    17,
    routeStatus([
      condition(
        "Accepted",
        "False",
        "NotAllowedByListeners",
        "listener postgres refuses this namespace",
      ),
      condition("ResolvedRefs", "True", "ResolvedRefs"),
    ]),
    { phase: "Cluster in healthy state" },
  );
  assert.match(
    out,
    /- type: DatabaseRouteReady\n {4}status: "False"\n {4}reason: "NotAllowedByListeners"\n {4}message: "listener postgres refuses this namespace"/,
  );
});

test("with database-routes on, a route not yet observed projects a False DatabaseRouteReady condition with reason Provisioning, not Routed", async () => {
  const out = await projectedStatus(17, undefined, {
    phase: "Cluster in healthy state",
  });
  assert.match(
    out,
    /- type: DatabaseRouteReady\n {4}status: "False"\n {4}reason: "Provisioning"/,
  );
  assert.doesNotMatch(out, /reason: "Routed"/);
});

test("with database-routes on a Postgres 16 database, which composes no route, projects no DatabaseRouteReady condition", async () => {
  const out = await projectedStatus(16, undefined, {});
  assert.doesNotMatch(out, /DatabaseRouteReady/);
});

test("with database-routes off, the composition projects no DatabaseRouteReady condition", async () => {
  const out = await chart();
  assert.doesNotMatch(out, /DatabaseRouteReady/);
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: infra/plans/15-next-horizon.md (Step 7, item 3); issue #1761, under #1116.
// With golden-path-signin on, the delivered HTTPRoutes send /oauth2 and
// /login/oauth2 to the BFF beside /api, in both route shapes: the Service's own
// Gateway route and the <service>-shared route on the shared platform Gateway.
// With the flag off or absent both routes send only /api to the BFF, so the
// render is unchanged.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const issuer = "https://keycloak.kore.internal/realms/platform";
const host = "auth.acme.kore.internal";

const workload = [
  "--set",
  "service=auth",
  "--set",
  `frontend.image=${frontend}`,
  "--set",
  `bff.image=${bff}`,
  "--set",
  `ingress.host=${host}`,
  "--set",
  "ingress.gatewayClassName=agentgateway",
  "--set",
  "ingress.issuer=kore-local-ca",
];
const sharedGateway = [
  "--set",
  "ingress.sharedGateway.name=kore-shared",
  "--set",
  "ingress.sharedGateway.namespace=kore-system",
  "--set",
  "ingress.sharedGateway.domain=acme.kore.internal",
];
const signinOn = [
  "--set",
  "signin.enabled=true",
  "--set-string",
  `signin.issuerUri=${issuer}`,
];

async function render(...set: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(root, "infra/charts/golden-path-workload"),
    ...set,
  ]);
  return stdout;
}

/** The rules block of the HTTPRoute called name in the render, from its first line to its last. */
async function routeRules(name: string, ...set: string[]): Promise<string> {
  const docs = (await render(...set)).split("\n---\n");
  const route = docs.find(
    (doc) =>
      /^kind: HTTPRoute$/m.test(doc) && doc.includes(`\n  name: ${name}\n`),
  );
  assert.ok(route, `the render has no HTTPRoute named ${name}`);
  return route.slice(route.indexOf("  rules:\n")).trimEnd();
}

const apiOnlyRules = `  rules:
    - matches:
        - path: {type: PathPrefix, value: /api}
      backendRefs:
        - {name: auth-bff, port: 80}
    - backendRefs:
        - {name: auth-frontend, port: 80}`;

const signinRules = `  rules:
    - matches:
        - path: {type: PathPrefix, value: /api}
        - path: {type: PathPrefix, value: /oauth2}
        - path: {type: PathPrefix, value: /login/oauth2}
      filters:
        - type: RequestHeaderModifier
          requestHeaderModifier:
            set:
              - {name: X-Forwarded-Proto, value: https}
      backendRefs:
        - {name: auth-bff, port: 80}
    - backendRefs:
        - {name: auth-frontend, port: 80}`;

test("with golden-path-signin on the own-Gateway route sends /oauth2 and /login/oauth2 to the BFF beside /api, and the rest to the frontend", async () => {
  expect(await routeRules("auth", ...workload, ...signinOn)).toBe(signinRules);
});

test("with golden-path-signin on the shared-Gateway route sends /oauth2 and /login/oauth2 to the BFF beside /api, and the rest to the frontend", async () => {
  expect(
    await routeRules("auth-shared", ...workload, ...sharedGateway, ...signinOn),
  ).toBe(signinRules);
});

test("with golden-path-signin off or absent the own-Gateway route sends only /api to the BFF, never the sign-in paths", async () => {
  expect(await routeRules("auth", ...workload)).toBe(apiOnlyRules);
  expect(
    await routeRules("auth", ...workload, "--set", "signin.enabled=false"),
  ).toBe(apiOnlyRules);
});

test("with golden-path-signin off or absent the shared-Gateway route sends only /api to the BFF, never the sign-in paths", async () => {
  expect(await routeRules("auth-shared", ...workload, ...sharedGateway)).toBe(
    apiOnlyRules,
  );
  expect(
    await routeRules(
      "auth-shared",
      ...workload,
      ...sharedGateway,
      "--set",
      "signin.enabled=false",
    ),
  ).toBe(apiOnlyRules);
});

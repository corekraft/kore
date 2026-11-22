import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: infra/plans/15-next-horizon.md (Step 7, item 3); issue #1746.
// With golden-path-signin on, the golden-path ApplicationSet passes the issuer to
// each Service's workload, which renders one Crossplane Keycloak client for that
// Service and gives its BFF the sign-in variables. With the flag off every render
// is byte-identical to the render taken from main, and no client secret is ever
// rendered: the client secret is a Crossplane connection Secret the workload reads
// by reference.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const revision = "c".repeat(40);
const lockEntries = JSON.stringify({
  "static-frontend": {
    image: "ghcr.io/corekraft/kore/static-frontend-template",
    digest: `sha256:${"a".repeat(64)}`,
    signer: "s",
  },
  "kotlin-bff": {
    image: "ghcr.io/corekraft/kore/kotlin-bff-template",
    digest: `sha256:${"b".repeat(64)}`,
    signer: "s",
  },
});
const issuer = "https://keycloak.kore.internal/realms/platform";
const host = "auth.acme.kore.internal";
const callback = `https://${host}/login/oauth2/code/golden-path`;
const golden = "tools/kore/integration/config/fixtures";

async function render(chart: string, ...set: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    chart,
    join(root, "infra/charts", chart),
    ...set,
  ]);
  return stdout;
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  throw new Error("the render was expected to fail");
}

async function fixture(name: string): Promise<string> {
  return readFile(join(await findRoot(), golden, name), "utf8");
}

const documents = (stdout: string) =>
  stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
const kindOf = (doc: string) => /^kind: (\w+)$/m.exec(doc)![1];

const deliveryIngress = [
  "--set-string",
  "ingress.platformDomain=kore.internal",
  "--set-string",
  "ingress.gatewayClassName=agentgateway",
];
const delivery = [
  "--set-string",
  "repoURL=https://github.com/corekraft/kore.git",
  "--set-string",
  `revision=${revision}`,
  "--set-string",
  "environment=local",
  "--set-json",
  `templateImages=${lockEntries}`,
  ...deliveryIngress,
];
const workloadIngress = [
  "--set",
  "ingress.host=" + host,
  "--set",
  "ingress.gatewayClassName=agentgateway",
  "--set",
  "ingress.issuer=kore-local-ca",
];
const workload = [
  "--set",
  "service=auth",
  "--set",
  `frontend.image=${frontend}`,
  "--set",
  `bff.image=${bff}`,
];
const signinOn = [
  "--set",
  "signin.enabled=true",
  "--set-string",
  `signin.issuerUri=${issuer}`,
];

test("with golden-path-signin off the delivery renders byte-identical to the render taken from main", async () => {
  const rendered = await render("golden-path-delivery", ...delivery);
  assert.equal(
    rendered.trimEnd(),
    (await fixture("golden-path-delivery-default.golden.yaml")).trimEnd(),
  );
});

test("with the issuer passed the sync gives every workload signin.enabled and the issuer", async () => {
  const set = await render(
    "golden-path-delivery",
    ...delivery,
    "--set-string",
    `signin.issuerUri=${issuer}`,
  );
  expect(set).toContain(
    `            - name: signin.enabled
              value: "true"
            - name: signin.issuerUri
              value: "${issuer}"
`,
  );
});

test("signin without an ingress host is refused, naming the host its redirect URI needs", async () => {
  const message = await failure(
    render(
      "golden-path-delivery",
      "--set-string",
      "repoURL=https://github.com/corekraft/kore.git",
      "--set-string",
      `revision=${revision}`,
      "--set-string",
      "environment=local",
      "--set-json",
      `templateImages=${lockEntries}`,
      "--set-string",
      `signin.issuerUri=${issuer}`,
    ),
  );
  expect(message).toMatch(/signin.*ingress/);
});

test("with golden-path-signin off the workload renders byte-identical to the render taken from main, whether signin is absent or false", async () => {
  const expected = (
    await fixture("golden-path-workload-ingress.golden.yaml")
  ).trimEnd();
  expect(
    (
      await render("golden-path-workload", ...workload, ...workloadIngress)
    ).trimEnd(),
  ).toBe(expected);
  expect(
    (
      await render(
        "golden-path-workload",
        ...workload,
        ...workloadIngress,
        "--set",
        "signin.enabled=false",
      )
    ).trimEnd(),
  ).toBe(expected);
});

test("with golden-path-signin on the workload renders exactly one Keycloak client for its Service, whose only redirect URI is the Service's HTTPS callback", async () => {
  const docs = documents(
    await render(
      "golden-path-workload",
      ...workload,
      ...workloadIngress,
      ...signinOn,
    ),
  );
  const clients = docs.filter((doc) => kindOf(doc) === "Client");
  expect(clients).toHaveLength(1);
  const client = clients[0]!;
  expect(client).toContain(
    "apiVersion: openidclient.keycloak.m.crossplane.io/v1alpha1\n",
  );
  expect(client).toContain("metadata:\n  name: golden-path-auth\n");
  expect(client).toContain("    realmId: platform\n");
  expect(client).toContain("    clientId: golden-path-auth\n");
  expect(client).toContain("    accessType: CONFIDENTIAL\n");
  expect(client).toContain(`    rootUrl: https://${host}\n`);
  expect(client).toContain(`    baseUrl: https://${host}\n`);
  expect(client).toContain(`    validRedirectUris:\n      - ${callback}\n`);
  expect(client.match(/- https:\/\//g)).toHaveLength(1);
  expect(client).toContain(
    "  writeConnectionSecretToRef:\n    name: auth-oidc\n",
  );
});

test("with golden-path-signin on only the BFF gets the sign-in variables, and its client secret is read by reference from the connection Secret", async () => {
  const docs = documents(
    await render(
      "golden-path-workload",
      ...workload,
      ...workloadIngress,
      ...signinOn,
    ),
  );
  const deployment = (name: string) =>
    docs.find(
      (doc) =>
        kindOf(doc) === "Deployment" && doc.includes(`\n  name: ${name}\n`),
    )!;
  expect(deployment("auth-bff")).toContain(`          env:
            - name: GOLDEN_PATH_SIGNIN
              value: "true"
            - name: OIDC_ISSUER_URI
              value: "${issuer}"
            - name: OIDC_CLIENT_ID
              value: "golden-path-auth"
            - name: OIDC_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: auth-oidc
                  key: client_secret
`);
  expect(deployment("auth-frontend")).not.toMatch(
    /env:|GOLDEN_PATH_SIGNIN|OIDC_/,
  );
});

test("the rendered sign-in output carries no client secret value, only the reference to it", async () => {
  const rendered = await render(
    "golden-path-workload",
    ...workload,
    ...workloadIngress,
    ...signinOn,
  );
  expect(rendered).not.toMatch(/OIDC_CLIENT_SECRET\n\s+value:/);
  expect(rendered).not.toMatch(/client[-_]secret:\s*\S/i);
});

test("with golden-path-signin off the workload renders no client, no sign-in variable and no secret reference", async () => {
  const rendered = await render(
    "golden-path-workload",
    ...workload,
    ...workloadIngress,
  );
  expect(rendered).not.toMatch(
    /kind: Client|GOLDEN_PATH_SIGNIN|OIDC_|auth-oidc/,
  );
});

test("signin without an ingress host is refused by the workload, naming the host the redirect URI needs", async () => {
  const message = await failure(
    render("golden-path-workload", ...workload, ...signinOn),
  );
  expect(message).toMatch(/ingress\.host/);
});

test("signin without an issuer is refused by the workload, naming signin.issuerUri", async () => {
  const message = await failure(
    render(
      "golden-path-workload",
      ...workload,
      ...workloadIngress,
      "--set",
      "signin.enabled=true",
    ),
  );
  expect(message).toMatch(/signin\.issuerUri/);
});

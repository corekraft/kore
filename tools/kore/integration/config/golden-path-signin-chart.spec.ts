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
    if (error instanceof Error && "stderr" in error) {
      return String(error.stderr);
    }
    throw error;
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
                  key: clientSecret
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

const signinDocs = async (...extra: string[]) =>
  documents(
    await render(
      "golden-path-workload",
      ...workload,
      ...workloadIngress,
      ...signinOn,
      ...extra,
    ),
  );
const deploymentOf = (docs: string[], name: string) =>
  docs.find(
    (doc) =>
      kindOf(doc) === "Deployment" && doc.includes(`\n  name: ${name}\n`),
  )!;

test("with golden-path-signin on the workload renders a cert-manager Certificate whose Secret carries the local CA, issued by the ingress issuer", async () => {
  const certificates = (await signinDocs()).filter(
    (doc) =>
      kindOf(doc) === "Certificate" && doc.includes("name: auth-bff-ca\n"),
  );
  expect(certificates).toHaveLength(1);
  const certificate = certificates[0]!;
  expect(certificate).toContain("apiVersion: cert-manager.io/v1\n");
  expect(certificate).toContain("metadata:\n  name: auth-bff-ca\n");
  expect(certificate).toContain("  secretName: auth-bff-ca\n");
  expect(certificate).toContain(
    "  issuerRef:\n    kind: ClusterIssuer\n    name: kore-local-ca\n",
  );
});

test("the BFF CA Certificate follows ingress.issuer when the Service sets one", async () => {
  const docs = documents(
    await render(
      "golden-path-workload",
      ...workload,
      "--set",
      "ingress.host=" + host,
      "--set",
      "ingress.gatewayClassName=agentgateway",
      "--set",
      "ingress.issuer=other-ca",
      ...signinOn,
    ),
  );
  const certificate = docs.find(
    (doc) =>
      kindOf(doc) === "Certificate" && doc.includes("name: auth-bff-ca\n"),
  )!;
  expect(certificate).toContain("    name: other-ca\n");
  expect(certificate).not.toContain("kore-local-ca");
});

test("with golden-path-signin on the BFF builds a truststore of the JDK roots plus the local CA in an init container, and the frontend is untouched", async () => {
  const docs = await signinDocs();
  const bffDeployment = deploymentOf(docs, "auth-bff");
  expect(bffDeployment).toContain(`      initContainers:
        - name: truststore
          image: "${bff}"
          command:
            - sh
            - -c
            - |
              set -eu
              cp "$JAVA_HOME/lib/security/cacerts" /truststore/cacerts
              chmod u+w /truststore/cacerts
              keytool -importcert -noprompt -alias kore-local-ca -file /ca/ca.crt -keystore /truststore/cacerts -storepass changeit
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
          volumeMounts:
            - {name: truststore, mountPath: /truststore}
            - {name: bff-ca, mountPath: /ca, readOnly: true}
`);
  expect(bffDeployment).toContain(`      volumes:
        - name: truststore
          emptyDir: {}
        - name: bff-ca
          secret:
            secretName: auth-bff-ca
            items:
              - {key: ca.crt, path: ca.crt}
`);
  const frontend = deploymentOf(docs, "auth-frontend");
  expect(frontend).not.toMatch(
    /initContainers|volumes|truststore|JAVA_TOOL_OPTIONS|bff-ca/,
  );
});

test("with golden-path-signin on only the bff container gets JAVA_TOOL_OPTIONS pointing at the truststore, and never mounts the private key", async () => {
  const bffDeployment = deploymentOf(await signinDocs(), "auth-bff");
  expect(bffDeployment).toContain(`            - name: JAVA_TOOL_OPTIONS
              value: "-Djavax.net.ssl.trustStore=/truststore/cacerts -Djavax.net.ssl.trustStorePassword=changeit"
`);
  expect(bffDeployment).toContain(`          volumeMounts:
            - {name: truststore, mountPath: /truststore, readOnly: true}
`);
  expect(bffDeployment).not.toMatch(/tls\.key|auth-tls/);
  expect(bffDeployment.match(/JAVA_TOOL_OPTIONS/g)).toHaveLength(1);
});

test("with golden-path-signin off the workload renders no truststore, no BFF CA Certificate and no JAVA_TOOL_OPTIONS", async () => {
  const rendered = await render(
    "golden-path-workload",
    ...workload,
    ...workloadIngress,
  );
  expect(rendered).not.toMatch(
    /initContainers|truststore|bff-ca|JAVA_TOOL_OPTIONS|trustStore/,
  );
});

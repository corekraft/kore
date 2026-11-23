import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1841 (for #1747), docs/decisions/0182. With golden-path-signin
// on, the BFF keeps its sign-in session in a PostgreSQL database the platform
// PostgreSQL API claims for the Service (Spring Session JDBC), so the signed-in
// BFF can run more than one replica. The claim is not retained data, so it
// deletes with the release. The BFF reads the API's connection output by
// reference, and no credential is rendered. With sign-in off none of it renders.

const run = promisify(execFile);
const frontendImage = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;

async function render(...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(root, "infra/charts/golden-path-workload"),
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const workload = [
  "--set",
  "service=auth",
  "--set",
  `frontend.image=${frontendImage}`,
  "--set",
  `bff.image=${bff}`,
  "--set",
  "ingress.host=auth.acme.kore.internal",
  "--set",
  "ingress.gatewayClassName=agentgateway",
  "--set",
  "ingress.issuer=kore-local-ca",
];
const signinOn = [
  "--set",
  "signin.enabled=true",
  "--set-string",
  "signin.issuerUri=https://keycloak.kore.internal/realms/platform",
];

const ofKind = (docs: string[], kind: string) =>
  docs.filter((doc) => new RegExp(`^kind: ${kind}$`, "m").test(doc));
const named = (docs: string[], kind: string, name: string) =>
  ofKind(docs, kind).find((doc) => doc.includes(`\n  name: ${name}\n`));

test("with golden-path-signin on the workload claims one PostgreSQLInstance for the Service, standard class and not retained", async () => {
  const docs = await render(...workload, ...signinOn);
  const claims = ofKind(docs, "PostgreSQLInstance");
  expect(claims).toHaveLength(1);
  const claim = claims[0]!;
  expect(claim).toContain("apiVersion: platform.kore.dev/v1alpha1\n");
  expect(claim).toContain("metadata:\n  name: auth-db\n");
  expect(claim).toContain("  serviceClass: standard\n");
  expect(claim).toContain("  connectionSecretName: auth-db-connection\n");
  expect(claim).toContain("  retentionPolicy: Delete\n");
  expect(claim).toMatch(/  storageSize: 1Gi\n/);
  expect(claim).toMatch(/  compatibilityVersion: 17\n/);
});

test("with golden-path-signin on only the BFF reads its datasource from the claim's connection output by reference", async () => {
  const docs = await render(...workload, ...signinOn);
  const bffDeployment = named(docs, "Deployment", "auth-bff")!;
  for (const [variable, secret, key] of [
    ["SESSION_DB_HOST", "auth-db-connection", "host"],
    ["SESSION_DB_PORT", "auth-db-connection", "port"],
    ["SESSION_DB_NAME", "auth-db-connection", "database"],
    ["SESSION_DB_SSLMODE", "auth-db-connection", "sslmode"],
    ["SPRING_DATASOURCE_USERNAME", "auth-db-connection", "username"],
    ["SPRING_DATASOURCE_PASSWORD", "auth-db-app", "password"],
  ] as const) {
    expect(bffDeployment).toContain(`            - name: ${variable}
              valueFrom:
                secretKeyRef:
                  name: ${secret}
                  key: ${key}
`);
  }
  expect(bffDeployment).toContain(
    '            - name: SPRING_DATASOURCE_URL\n              value: "jdbc:postgresql://$(SESSION_DB_HOST):$(SESSION_DB_PORT)/$(SESSION_DB_NAME)?sslmode=$(SESSION_DB_SSLMODE)"\n',
  );
  expect(named(docs, "Deployment", "auth-frontend")).not.toMatch(
    /SESSION_DB|SPRING_DATASOURCE/,
  );
});

test("a variable the datasource URL expands is defined before the URL", async () => {
  const docs = await render(...workload, ...signinOn);
  const bffDeployment = named(docs, "Deployment", "auth-bff")!;
  const url = bffDeployment.indexOf("name: SPRING_DATASOURCE_URL");
  for (const variable of [
    "SESSION_DB_HOST",
    "SESSION_DB_PORT",
    "SESSION_DB_NAME",
    "SESSION_DB_SSLMODE",
  ]) {
    const at = bffDeployment.indexOf(`name: ${variable}\n`);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(url);
  }
});

test("the rendered sign-in output carries no database password value, only the reference to it", async () => {
  const docs = await render(...workload, ...signinOn);
  expect(docs.join("\n---\n")).not.toMatch(
    /SPRING_DATASOURCE_PASSWORD\n\s+value:/,
  );
  expect(docs.join("\n---\n")).not.toMatch(/\bpassword:\s*\S/i);
});

test("the database claim takes its size and version from the chart values", async () => {
  const docs = await render(
    ...workload,
    ...signinOn,
    "--set",
    "database.storageSize=2Gi",
    "--set",
    "database.compatibilityVersion=18",
  );
  const claim = ofKind(docs, "PostgreSQLInstance")[0]!;
  expect(claim).toMatch(/  storageSize: 2Gi\n/);
  expect(claim).toMatch(/  compatibilityVersion: 18\n/);
});

test("with golden-path-signin off the workload renders no database claim and no datasource variable", async () => {
  const docs = await render(...workload);
  expect(ofKind(docs, "PostgreSQLInstance")).toHaveLength(0);
  expect(docs.join("\n---\n")).not.toMatch(
    /PostgreSQLInstance|SESSION_DB|SPRING_DATASOURCE|auth-db/,
  );
});

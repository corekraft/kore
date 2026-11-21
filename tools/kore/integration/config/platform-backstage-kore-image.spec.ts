import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  platformHelmArgs,
  type Repository,
} from "../../src/config/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md
// The Kore-built image is the chart's Backstage (issue 1708); the chart's other
// behaviour is in platform-backstage-chart.spec.ts.

const platform = await localPlatform();
const run = promisify(execFile);

// The flag is off here, as in platform-backstage-chart.spec.ts: the shared
// Gateway's route is covered there.
async function localRepository(): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        "platform-shared-gateway": false,
      },
    },
  };
}

async function render(): Promise<string> {
  const root = await findRoot();
  const repository = await localRepository();
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  const values = [
    ...(component?.values ?? []),
    ...(repository.environment.componentValues?.["kore-platform-backstage"] ??
      []),
  ].flatMap((file) => ["--values", join(root, file)]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-backstage",
    join(root, "infra/charts/platform-backstage"),
    "--namespace",
    "backstage",
    ...values,
    ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
  ]);
  return stdout;
}

const document = (rendered: string, kind: string): string =>
  rendered
    .split(/^---$/m)
    .find((part) => new RegExp("^kind: " + kind + "$", "m").test(part)) ?? "";

// The Kore-built image (issue 1708): the digest the v0.20.0 release recorded in
// backstage-image.lock.json, signed by that tag's release workflow.
const koreBackstageImage =
  "ghcr.io/corekraft/kore/backstage@sha256:86ea69871da3e31af13bd1880ae9a96d54577681d1f3bb10b85716ccb5790157";

const backstageContainer = (deployment: string): string =>
  deployment
    .split(/^ {8}- name: /m)
    .find((part) => part.startsWith("backstage\n")) ?? "";

// An env entry as the chart renders it: its name, then its literal value line.
const envValue = (name: string, value: string): RegExp =>
  new RegExp(
    "- name: " + name + "\\n\\s+value: " + escapeRegExp(value) + "\\n",
  );

test("the Backstage container runs the Kore-built image at the digest the release lock records, never upstream's", async () => {
  const deployment = document(await render(), "Deployment");
  assert.ok(
    backstageContainer(deployment).includes(
      'image: "' + koreBackstageImage + '"',
    ),
  );
  assert.equal(deployment.includes("ghcr.io/backstage/backstage"), false);
});

test("the Kore image starts without the guest sign-in override, since its config signs in only through Keycloak", async () => {
  const deployment = document(await render(), "Deployment");
  assert.equal(deployment.includes("auth_providers_guest"), false);
  assert.equal(
    deployment.includes("dangerouslyAllowOutsideDevelopment"),
    false,
  );
});

test("the Kore image gets its OIDC settings: the platform realm's metadata, the client id and the client secret by reference", async () => {
  const container = backstageContainer(document(await render(), "Deployment"));
  assert.match(
    container,
    envValue(
      "OIDC_METADATA_URL",
      "https://keycloak." +
        platform.domain +
        "/realms/platform/.well-known/openid-configuration",
    ),
  );
  assert.match(container, envValue("OIDC_CLIENT_ID", "backstage"));
  assert.match(
    container,
    new RegExp(
      "- name: OIDC_CLIENT_SECRET\\n\\s+valueFrom:\\n\\s+secretKeyRef:\\n\\s+name: backstage-oidc\\n\\s+key: client-secret\\n",
    ),
  );
});

test("the Backstage container runs as the image's numeric user under runAsNonRoot, so the kubelet can verify it", async () => {
  const deployment = document(await render(), "Deployment");
  assert.match(deployment, /^ {8}runAsNonRoot: true$/m);
  assert.match(backstageContainer(deployment), /^ {12}runAsUser: 65532$/m);
});

test("the Kore image's baked localhost URLs are overridden to the portal host, so the OIDC callback is the one Keycloak registered", async () => {
  const container = backstageContainer(document(await render(), "Deployment"));
  assert.match(
    container,
    envValue("APP_CONFIG_app_baseUrl", "https://backstage." + platform.domain),
  );
  assert.match(
    container,
    envValue(
      "APP_CONFIG_backend_baseUrl",
      "https://backstage." + platform.domain,
    ),
  );
});

test("the database connection comes from the claimed database, since the Kore image's config names none and no POSTGRES_ variable is read", async () => {
  const deployment = document(await render(), "Deployment");
  const container = backstageContainer(deployment);
  assert.match(
    container,
    envValue("APP_CONFIG_backend_database_connection_host", "backstage-db-rw"),
  );
  assert.match(
    container,
    envValue("APP_CONFIG_backend_database_connection_port", '"5432"'),
  );
  assert.match(
    container,
    new RegExp(
      "- name: APP_CONFIG_backend_database_connection_user\\n\\s+valueFrom:\\n\\s+secretKeyRef:\\n\\s+name: backstage-db-app\\n\\s+key: username\\n",
    ),
  );
  assert.match(
    container,
    new RegExp(
      "- name: APP_CONFIG_backend_database_connection_password\\n\\s+valueFrom:\\n\\s+secretKeyRef:\\n\\s+name: backstage-db-app\\n\\s+key: password\\n",
    ),
  );
  assert.equal(deployment.includes("POSTGRES_"), false);
});

test("the Backstage container has a readiness probe the Kore image can pass: its entrypoint node binary, by absolute path, asks the loopback readiness route", async () => {
  const container = backstageContainer(document(await render(), "Deployment"));
  assert.ok(
    container.includes(
      "readinessProbe:\n            exec:\n              command:\n                - /nodejs/bin/node\n",
    ),
    "exec probe with the absolute node path",
  );
  assert.equal(
    /^ {16}- node$/m.test(container),
    false,
    "no bare node: the distroless PATH has none",
  );
  assert.ok(
    container.includes("http://127.0.0.1:7007/.backstage/health/v1/readiness"),
  );
});

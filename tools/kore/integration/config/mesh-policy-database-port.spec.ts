import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  agentgatewayMeshEnrollmentFlag,
  ingressFlag,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import { localPlatform } from "../local-platform-support.js";

// Docs: docs/decisions/0081-agentgateway-replaces-istio-ingress.md
// Docs: docs/decisions/0136-the-shared-gateway-serves-database-routes-on-a-loopback-5432-passthrough-listener-behind-database-routes.md

// The gateway pod is enrolled in the ambient mesh, so its STRICT PeerAuthentication
// rejects plaintext on every port but the ones it names. With database-routes on,
// the database listener's port joins the listener port as PERMISSIVE, and the ALLOW
// policy admits it. Off, the render is the golden captured before the flag existed.

const platform = await localPlatform();
const gatewayPort = String(platform.gatewayPort);
const postgresPort = "5432";
const databaseRoutesFlag = "database-routes";
const sharedGatewayFlag = "platform-shared-gateway";

const enrolled = {
  [ingressFlag]: true,
  [agentgatewayMeshEnrollmentFlag]: true,
};

async function overlay(features: Record<string, boolean>): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        [sharedGatewayFlag]: false,
        ...features,
      },
    },
  };
}

function render(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

function documents(output: string, kind: string): string[] {
  return output.split(/^---$/m).filter((doc) => doc.includes(`kind: ${kind}`));
}

// The documents mesh-policy.yaml renders; the Gateway and its Service change with
// the same flag (ADR 0136) and are not this template's concern.
function meshPolicy(output: string): string {
  return output
    .split(/^---$/m)
    .filter((doc) => doc.includes("templates/mesh-policy.yaml"))
    .join("---");
}

function gatewayPeerAuthentication(output: string): string {
  return documents(output, "PeerAuthentication").find((doc) =>
    doc.includes("name: kore-gateway-listener"),
  )!;
}

function allowPolicy(output: string): string {
  return documents(output, "AuthorizationPolicy").find((doc) =>
    doc.includes("name: gateway-allow-https"),
  )!;
}

test("with database-routes off the enrolled render is the golden captured before the flag existed", async () => {
  const repository = await overlay({
    ...enrolled,
    [databaseRoutesFlag]: false,
  });
  const golden = await readFile(
    `${repository.root}/tools/kore/integration/config/fixtures/mesh-policy-enrolled-off.golden.yaml`,
    "utf8",
  );
  assert.equal(render(repository), golden);
});

test("with database-routes on the mesh policy changes only its PeerAuthentication port list and its ALLOW ports", async () => {
  const off = meshPolicy(
    render(await overlay({ ...enrolled, [databaseRoutesFlag]: false })),
  );
  const on = meshPolicy(
    render(await overlay({ ...enrolled, [databaseRoutesFlag]: true })),
  );
  const expected = off
    .replace(
      "# Only the gateway's listener port is permissive, the same exposure the Istio\n# gateway has; every other port and workload stays STRICT.\n",
      "# Only the gateway's listener port and, behind database-routes, the database\n# listener's port are permissive, the same exposure the Istio gateway has; every\n# other port and workload stays STRICT.\n",
    )
    .replace(
      `ports: ["${gatewayPort}"]`,
      `ports: ["${gatewayPort}", "${postgresPort}"]`,
    )
    .replace(
      `    "${gatewayPort}": {mode: PERMISSIVE}\n`,
      `    "${gatewayPort}": {mode: PERMISSIVE}\n    "${postgresPort}": {mode: PERMISSIVE}\n`,
    );
  assert.equal(on, expected);
  assert.equal(on.match(/PERMISSIVE/g)?.length, 2);
});

test("with database-routes on the gateway PeerAuthentication keeps STRICT as the default and PERMISSIVE on exactly two ports", async () => {
  const peer = gatewayPeerAuthentication(
    render(await overlay({ ...enrolled, [databaseRoutesFlag]: true })),
  );
  assert.match(peer, /mtls: \{mode: STRICT\}/);
  assert.match(
    peer,
    new RegExp(
      `portLevelMtls:\\n    "${gatewayPort}": \\{mode: PERMISSIVE\\}\\n    "${postgresPort}": \\{mode: PERMISSIVE\\}\\n?$`,
    ),
  );
  assert.equal(peer.match(/PERMISSIVE/g)?.length, 2);
  assert.doesNotMatch(peer, /mode: DISABLE/);
});

test("with database-routes on the ALLOW policy admits the database port beside the listener port", async () => {
  const allow = allowPolicy(
    render(await overlay({ ...enrolled, [databaseRoutesFlag]: true })),
  );
  assert.match(
    allow,
    new RegExp(`ports: \\["${gatewayPort}", "${postgresPort}"\\]`),
  );
});

test("with database-routes on under the Istio class, the ALLOW policy still admits the database port and no gateway PeerAuthentication is added", async () => {
  const output = render(
    await overlay({ [ingressFlag]: false, [databaseRoutesFlag]: true }),
  );
  assert.match(
    allowPolicy(output),
    new RegExp(`ports: \\["${gatewayPort}", "${postgresPort}"\\]`),
  );
  assert.equal(documents(output, "PeerAuthentication").length, 1);
  assert.doesNotMatch(output, /kore-gateway-listener/);
});

test("with database-routes off under the Istio class the ALLOW policy admits the listener port only", async () => {
  const output = render(
    await overlay({ [ingressFlag]: false, [databaseRoutesFlag]: false }),
  );
  assert.match(
    allowPolicy(output),
    new RegExp(`ports: \\["${gatewayPort}"\\]`),
  );
  assert.doesNotMatch(output, new RegExp(`"${postgresPort}"`));
});

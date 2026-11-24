import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  loadRepository,
  validateRepository,
  type Repository,
} from "../../src/config/index.js";
import { render } from "./gateway-service-support.js";

// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
// Spec #1612, issue 1633: the external Gateway and the ListenerSet admission render behind two dark flags.

const externalFlags = [
  "platform-shared-gateway",
  "service-listener-sets",
  "external-gateway",
];

/** The repository with the given flags set on or off, the rest as the overlay has them. */
function withFeatures(
  repository: Repository,
  features: Record<string, boolean>,
): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, ...features },
    },
  };
}

/** The one rendered document of a kind and name, or undefined when none renders. */
function documentNamed(
  output: string,
  kind: string,
  name: string,
): string | undefined {
  return output
    .split(/^---$/m)
    .find(
      (document) =>
        new RegExp(`^kind: ${kind}$`, "m").test(document) &&
        new RegExp(`^  name: ${name}$`, "m").test(document),
    );
}

async function golden(name: string): Promise<string> {
  const repository = await loadRepository("vps");
  return readFile(
    `${repository.root}/tools/kore/src/platform/fixtures/${name}`,
    "utf8",
  );
}

test.each([
  ["local", "platform-config-overlay-local.yaml"],
  ["managed-example", "platform-config-overlay-managed-example.yaml"],
  ["vps", "platform-config-overlay-vps.yaml"],
])(
  "with both new flags off the %s platform-config render is byte-identical to the render taken from main",
  async (name, file) => {
    const repository = await loadRepository(name);
    assert.equal(repository.environment.features?.["external-gateway"], false);
    assert.equal(
      repository.environment.features?.["service-listener-sets"],
      false,
    );
    assert.equal(render(repository), await golden(file));
  },
);

test("with external-gateway off nothing of the external Gateway renders, whatever the other flags", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, {
      ...Object.fromEntries(externalFlags.map((f) => [f, true])),
      "external-gateway": false,
    }),
  );
  assert.equal(
    documentNamed(output, "Gateway", "kore-gateway-external"),
    undefined,
  );
  assert.equal(
    documentNamed(output, "HTTPRoute", "kore-gateway-external-redirect"),
    undefined,
  );
  assert.doesNotMatch(output, /kore-gateway-external-service/);
});

test("with the external Gateway on it has one HTTP listener on port 80 and admits only HTTPRoute, from its own namespace", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, Object.fromEntries(externalFlags.map((f) => [f, true]))),
  );
  const gateway = documentNamed(output, "Gateway", "kore-gateway-external");
  assert.ok(gateway, "the external Gateway renders");
  assert.equal(
    [...gateway.matchAll(/^    - name: /gm)].length,
    1,
    "exactly one listener",
  );
  assert.match(gateway, /^    - name: http$/m);
  assert.match(gateway, /^      port: 80$/m);
  assert.match(gateway, /^      protocol: HTTP$/m);
  assert.match(gateway, /kind: HTTPRoute/);
  assert.doesNotMatch(gateway, /kind: (TLSRoute|TCPRoute|GRPCRoute)/);
  assert.match(gateway, /from: Same/);
});

test("the external Gateway never carries a passthrough, TCP, database or HTTPS listener, whatever other flags are on", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, {
      ...Object.fromEntries(externalFlags.map((f) => [f, true])),
      "database-routes": true,
      "registry-by-name": true,
      "otlp-route": true,
    }),
  );
  const gateway = documentNamed(output, "Gateway", "kore-gateway-external");
  assert.ok(gateway);
  assert.doesNotMatch(gateway, /Passthrough|protocol: (HTTPS|TLS|TCP)/);
  assert.doesNotMatch(gateway, /postgres|tls-registry|32000|5432/);
});

test("the external Gateway's redirect sends port 80 to HTTPS and is attached to its HTTP listener only", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, Object.fromEntries(externalFlags.map((f) => [f, true]))),
  );
  const redirect = documentNamed(
    output,
    "HTTPRoute",
    "kore-gateway-external-redirect",
  );
  assert.ok(redirect, "the redirect renders");
  assert.match(redirect, /sectionName: http/);
  assert.match(redirect, /type: RequestRedirect/);
  assert.match(redirect, /scheme: https/);
});

test("the external Gateway's Service publishes the overlay's external node port for HTTP", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, Object.fromEntries(externalFlags.map((f) => [f, true]))),
  );
  const service = output
    .split(/^---$/m)
    .find((d) => /kore-gateway-external-service/.test(d));
  assert.ok(service, "the external Service overlay renders");
  assert.match(service, /type: NodePort/);
  assert.match(service, /port: 80/);
  assert.match(service, /nodePort: 30080/);
});

test("the vps external node port matches the host port table for external-gateway-http", async () => {
  const base = await loadRepository("vps");
  const portTable = await readFile(
    `${base.root}/infra/hosts/vps/port-table.yaml`,
    "utf8",
  );
  const nodePort =
    /"name": "external-gateway-http"[\s\S]*?"nodePort": (\d+)/.exec(
      portTable,
    )?.[1];
  assert.equal(nodePort, "30080");
  const output = render(
    withFeatures(base, Object.fromEntries(externalFlags.map((f) => [f, true]))),
  );
  assert.match(output, new RegExp(`nodePort: ${nodePort}`));
});

test("with service-listener-sets on both Gateways admit ListenerSets only from namespaces carrying the shared-Gateway label", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, Object.fromEntries(externalFlags.map((f) => [f, true]))),
  );
  for (const name of ["kore-gateway", "kore-gateway-external"]) {
    const gateway = documentNamed(output, "Gateway", name);
    assert.ok(gateway, `${name} renders`);
    assert.match(
      gateway,
      /allowedListeners:\n\s+namespaces:\n\s+from: Selector\n\s+selector:\n\s+matchLabels:\n\s+platform\.kore\.dev\/shared-gateway: "true"/,
      name,
    );
  }
});

test("with service-listener-sets off neither Gateway carries an allowedListeners admission", async () => {
  const base = await loadRepository("vps");
  const output = render(
    withFeatures(base, {
      "platform-shared-gateway": true,
      "service-listener-sets": false,
      "external-gateway": false,
    }),
  );
  assert.doesNotMatch(output, /allowedListeners/);
});

test("external-gateway on with service-listener-sets off is refused, naming both flags", async () => {
  const base = await loadRepository("vps");
  await assert.rejects(
    validateRepository(
      withFeatures(base, {
        "platform-shared-gateway": true,
        "external-gateway": true,
        "service-listener-sets": false,
      }),
    ),
    /external-gateway.*service-listener-sets|service-listener-sets.*external-gateway/s,
  );
});

test("service-listener-sets on with platform-shared-gateway off is refused, naming both flags", async () => {
  const base = await loadRepository("vps");
  await assert.rejects(
    validateRepository(
      withFeatures(base, {
        "platform-shared-gateway": false,
        "service-listener-sets": true,
        "external-gateway": false,
      }),
    ),
    /service-listener-sets.*platform-shared-gateway|platform-shared-gateway.*service-listener-sets/s,
  );
});

test("the two flags are listed false in every overlay", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.["external-gateway"],
      false,
      `${name} external-gateway`,
    );
    assert.equal(
      repository.environment.features?.["service-listener-sets"],
      false,
      `${name} service-listener-sets`,
    );
  }
});

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import {
  loadRepository,
  validateRepository,
  type Repository,
  internalGateway,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import {
  withAbsoluteChart,
  withGatewayFlagsOff,
} from "../../src/testing/index.js";

// With registry-by-name on, the shared Gateway holds a TLS passthrough
// listener for the registry's name on the same port as its HTTPS listeners, and
// the registry chart routes that name to its own proxy, so the registry keeps
// its certificate, its authentication and ADR 0058's end-to-end verification.
// The flag off renders exactly what rendered before. These specs render the
// real charts, as the Helm path does, without a cluster.

const name = "registry.platform.kore.internal";

function render(repository: Repository, component: string): string {
  const found = repository.catalog.components.find((c) => c.name === component);
  assert.ok(found, `${component} is in the catalog`);
  return execFileSync(
    "helm",
    withAbsoluteChart(repository, found, helmTemplateArgs(repository, found)),
    { cwd: repository.root, encoding: "utf8" },
  );
}

async function repositoryWith(
  flags: Record<string, boolean | undefined>,
): Promise<Repository> {
  const base = withGatewayFlagsOff(await loadRepository("local"));
  const features: Record<string, boolean> = {
    ...base.environment.features,
    "platform-dns": false,
  };
  for (const [flag, on] of Object.entries(flags)) {
    if (on === undefined) {
      delete features[flag];
    } else {
      features[flag] = on;
    }
  }
  return {
    ...base,
    environment: {
      ...base.environment,
      platform: { domain: "kore.internal", organizationId: "platform" },
      features,
    },
  };
}

const sharedGatewayOn = { "platform-shared-gateway": true };

test("with registry-by-name on the Gateway gains a TLS passthrough listener for the registry's name on the HTTPS listeners' port", async () => {
  const repository = await repositoryWith({
    ...sharedGatewayOn,
    "registry-by-name": true,
  });
  const output = render(repository, "kore-platform-config");
  const port = internalGateway(repository.environment).port;
  assert.match(
    output,
    new RegExp(
      `- name: tls-registry\\s+hostname: "${name.replaceAll(".", "\\.")}"\\s+port: ${port}\\s+protocol: TLS\\s+tls:\\s+mode: Passthrough\\s+allowedRoutes:\\s+kinds: \\[\\{kind: TLSRoute\\}\\]\\s+namespaces: \\{from: Selector, selector: \\{matchLabels: \\{platform\\.kore\\.dev/shared-gateway: "true"\\}\\}\\}`,
    ),
  );
  assert.match(
    output,
    new RegExp(
      `- name: https\\s+hostname: "kore.internal"\\s+port: ${port}\\s+protocol: HTTPS`,
    ),
  );
  assert.match(
    output,
    new RegExp(
      `- name: https-platform\\s+hostname: "\\*.platform.kore.internal"\\s+port: ${port}\\s+protocol: HTTPS`,
    ),
  );
});

test("with registry-by-name off the Gateway renders exactly as it does with the flag absent, and holds no passthrough listener", async () => {
  const absent = render(
    await repositoryWith({ ...sharedGatewayOn, "registry-by-name": undefined }),
    "kore-platform-config",
  );
  const off = render(
    await repositoryWith({ ...sharedGatewayOn, "registry-by-name": false }),
    "kore-platform-config",
  );
  assert.equal(off, absent);
  assert.doesNotMatch(off, /Passthrough|TLSRoute|tls-registry/);
});

test("with registry-by-name on the registry chart routes the name to its own proxy through the shared Gateway's passthrough listener", async () => {
  const repository = await repositoryWith({
    ...sharedGatewayOn,
    "registry-by-name": true,
  });
  const output = render(repository, "oci-registry");
  const route = output
    .split(/^---\s*$/m)
    .find((doc) => /^kind: TLSRoute/m.test(doc));
  assert.ok(route, "a TLSRoute renders");
  assert.match(route, /name: oci-registry\s/);
  assert.match(route, /namespace: kore-registry/);
  assert.match(
    route,
    /parentRefs:\s+- group: gateway\.networking\.k8s\.io\s+kind: Gateway\s+name: "kore-gateway"\s+namespace: "kore-system"\s+sectionName: "tls-registry"/,
  );
  assert.match(
    route,
    new RegExp(`hostnames:\\s+- "${name.replaceAll(".", "\\.")}"`),
  );
  assert.match(route, /backendRefs:\s+- name: oci-registry\s+port: 5000/);
});

test("with registry-by-name on the registry's certificate carries the name beside the addresses it already carries", async () => {
  const output = render(
    await repositoryWith({ ...sharedGatewayOn, "registry-by-name": true }),
    "oci-registry",
  );
  const certificate = output
    .split(/^---\s*$/m)
    .find((doc) => /^ {2}name: oci-registry-tls$/m.test(doc));
  assert.ok(certificate, "the serving Certificate renders");
  assert.match(
    certificate,
    /dnsNames:\s+- oci-registry\s+- oci-registry\.kore-registry\s+- oci-registry\.kore-registry\.svc\s+- oci-registry\.kore-registry\.svc\.cluster\.local\s+- localhost\s+- "registry\.platform\.kore\.internal"\s+ipAddresses:\s+- "127\.0\.0\.1"\s+- "10\.96\.0\.50"/,
  );
});

test("with registry-by-name off the registry chart renders exactly as it does with the flag absent: no route, and the certificate gains no name", async () => {
  const absent = render(
    await repositoryWith({ ...sharedGatewayOn, "registry-by-name": undefined }),
    "oci-registry",
  );
  const off = render(
    await repositoryWith({ ...sharedGatewayOn, "registry-by-name": false }),
    "oci-registry",
  );
  assert.equal(off, absent);
  assert.doesNotMatch(off, /TLSRoute|registry\.platform\.kore\.internal/);
});

test("every Service port the registry chart renders is named", async () => {
  for (const flag of [true, false]) {
    const output = render(
      await repositoryWith({ ...sharedGatewayOn, "registry-by-name": flag }),
      "oci-registry",
    );
    const service = output
      .split(/^---\s*$/m)
      .find((doc) => /^kind: Service$/m.test(doc));
    assert.ok(service, "the Service renders");
    assert.match(
      service,
      /ports:\s+- name: registry\s+port: 5000\s+targetPort: registry/,
    );
  }
});

test("the registry chart's route attaches to the listener the platform chart declares, in the platform Gateway", async () => {
  const repository = await repositoryWith({
    ...sharedGatewayOn,
    "registry-by-name": true,
  });
  const gateway = render(repository, "kore-platform-config");
  const route = render(repository, "oci-registry");
  const section = /sectionName: "(\S+)"/.exec(route)?.[1];
  assert.ok(section, "the route names a listener");
  assert.match(gateway, new RegExp(`- name: ${section}\\s`));
  assert.match(
    gateway,
    new RegExp(
      `kind: Gateway\\s+metadata:\\s+name: ${internalGateway(repository.environment).name}\\s+namespace: ${internalGateway(repository.environment).namespace}`,
    ),
  );
});

test("registry-by-name on with platform-shared-gateway off is refused by validation before any chart renders, and accepted with both on", async () => {
  await assert.rejects(
    validateRepository(
      await repositoryWith({
        "platform-shared-gateway": false,
        "registry-by-name": true,
      }),
    ),
    /turns on registry-by-name, which needs platform-shared-gateway/,
  );
  await validateRepository(
    await repositoryWith({ ...sharedGatewayOn, "registry-by-name": true }),
  );
});

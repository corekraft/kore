// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// The platform Gateway's wildcard for the platform organization's names: one
// HTTPS listener beside the existing one, on the same port, with its own
// certificate from the local CA. The flag off renders none of it.

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

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": on,
      },
    },
  };
}

test("with platform-shared-gateway off the Gateway has its one HTTPS listener and no wildcard Certificate renders", async () => {
  const output = render(
    withSharedGateway(await loadRepository("local"), false),
  );
  assert.doesNotMatch(output, /\*\.platform\./);
  assert.doesNotMatch(output, /kore-platform-wildcard/);
  assert.doesNotMatch(output, /kind: Certificate/);
});

test("with platform-shared-gateway on the wildcard is a second HTTPS listener on the same port, beside kore.local", async () => {
  const repository = withSharedGateway(await loadRepository("local"), true);
  const { gateway } = repository.environment;
  const output = render(repository);
  // The existing listener is unchanged: kore.local on the Gateway's port.
  assert.match(
    output,
    new RegExp(
      `- name: https\\s+hostname: "kore\\.local"\\s+port: ${gateway.port}\\s+protocol: HTTPS`,
    ),
  );
  // The wildcard is a second listener, same port and protocol, with its own secret.
  assert.match(
    output,
    new RegExp(
      `- name: https-platform\\s+hostname: "\\*\\.platform\\.kore\\.local"\\s+port: ${gateway.port}\\s+protocol: HTTPS\\s+tls:\\s+mode: Terminate\\s+certificateRefs:\\s+- \\{kind: Secret, name: kore-platform-wildcard-tls\\}`,
    ),
  );
});

test("with platform-shared-gateway on a Certificate for the wildcard is issued by the local CA into kore-system", async () => {
  const output = render(withSharedGateway(await loadRepository("local"), true));
  assert.match(
    output,
    /kind: Certificate\s+metadata:\s+name: kore-platform-wildcard\s+namespace: kore-system[\s\S]*?secretName: kore-platform-wildcard-tls\s+dnsNames:\s+- "\*\.platform\.kore\.local"\s+issuerRef:\s+kind: ClusterIssuer\s+name: kore-local-ca/,
  );
});

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  componentValues,
  loadRepository,
  platformHelmArgs,
  type Repository,
  internalGateway,
} from "../../src/config/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

// Pods resolve the platform names to the shared Gateway and verify its
// certificate. The platform-dns chart owns the k3s custom DNS ConfigMap, and the
// portal's chart mounts the local CA. Both follow the platform-dns flag.

function helm(args: string[], repository: Repository): string {
  return execFileSync("helm", args, { cwd: repository.root, encoding: "utf8" });
}

function withDns(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, "platform-dns": on },
    },
  };
}

/** Renders the DNS chart the way kore does: its feature flags, then the values kore derives. */
function renderDns(repository: Repository): string {
  const featureArgs = Object.entries(repository.environment.features ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([flag, on]) => ["--set", `features.${flag}=${on}`]);
  return helm(
    [
      "template",
      "kore-platform-dns",
      join(repository.root, "infra/charts/platform-dns"),
      "--namespace",
      "kore-dns",
      ...componentValues(
        repository,
        repository.catalog.components.find(
          (c) => c.name === "kore-platform-dns",
        )!,
      ).flatMap((file) => ["--values", join(repository.root, file)]),
      ...featureArgs,
      ...platformHelmArgs(repository.environment, "kore-platform-dns"),
    ],
    repository,
  );
}

/** Renders the portal's chart from its value files and the values kore derives. */
function renderPortal(repository: Repository): string {
  const backstage = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  )!;
  return helm(
    [
      "template",
      "kore-platform-backstage",
      join(repository.root, "infra/charts/platform-backstage"),
      "--namespace",
      "backstage",
      ...componentValues(repository, backstage).flatMap((file) => [
        "--values",
        join(repository.root, file),
      ]),
      "--set-string",
      "gatewayClassName=agentgateway",
      ...platformHelmArgs(repository.environment, backstage.name),
    ],
    repository,
  );
}

function customDns(rendered: string): string | undefined {
  return rendered
    .split(/^---$/m)
    .find((doc) => /^\s*name: coredns-custom$/m.test(doc));
}

test("with platform-dns off no custom DNS ConfigMap renders, so the bundled DNS is untouched", async () => {
  const output = renderDns(withDns(await loadRepository("local"), false));
  assert.equal(customDns(output), undefined);
  assert.doesNotMatch(output, /coredns-custom/);
});

test("with platform-dns on the platform-dns chart renders the k3s custom DNS ConfigMap in kube-system", async () => {
  const document = customDns(
    renderDns(withDns(await loadRepository("local"), true)),
  );
  assert.ok(document, "the custom DNS ConfigMap renders");
  assert.match(document, /^kind: ConfigMap$/m);
  assert.match(document, /^ {2}namespace: kube-system$/m);
  assert.match(document, /^ {2}labels: \{[^}]*managed-by: Helm/m);
});

test("the zone is rewritten to the Gateway Service's DNS name, never an address", async () => {
  const { domain } = await localPlatform();
  const document =
    customDns(renderDns(withDns(await loadRepository("local"), true))) ?? "";
  assert.match(document, /^ {2}platform\.override: \|$/m);
  assert.match(
    document,
    new RegExp(
      `rewrite stop \\{\\s+name regex \\^\\(\\.\\+\\\\\\.\\)\\?${escapeRegExp(domain.replaceAll(".", "\\."))}\\\\\\.\\$ kore-gateway\\.kore-system\\.svc\\.cluster\\.local\\.\\s+answer auto\\s+\\}`,
    ),
  );
  assert.doesNotMatch(document, /\d+\.\d+\.\d+\.\d+/);
});

test("the Gateway the rewrite follows is the environment's, handed over by kore", async () => {
  const repository = await loadRepository("local");
  const args = platformHelmArgs(
    withDns(repository, true).environment,
    "kore-platform-dns",
  );
  assert.deepEqual(args.slice(-4), [
    "--set-string",
    `gateway.name=${internalGateway(repository.environment).name}`,
    "--set-string",
    `gateway.namespace=${internalGateway(repository.environment).namespace}`,
  ]);
});

test("no chart but platform-dns renders the custom DNS ConfigMap", async () => {
  const charts = join((await loadRepository("local")).root, "infra/charts");
  const owners = readdirSync(charts)
    .filter((name) => statSync(join(charts, name)).isDirectory())
    .filter((name) =>
      readdirSync(join(charts, name, "templates")).some((file) =>
        readFileSync(join(charts, name, "templates", file), "utf8").includes(
          "coredns-custom",
        ),
      ),
    );
  assert.deepEqual(owners, ["platform-dns"]);
});

test("with platform-dns off the portal mounts no CA bundle and trusts only the cluster CA as before", async () => {
  const output = renderPortal(withDns(await loadRepository("local"), false));
  assert.doesNotMatch(output, /configMap:\s+name: kore-local-ca/);
  assert.doesNotMatch(output, /provider-ca-file/);
  assert.match(
    output,
    /NODE_EXTRA_CA_CERTS\s+value: \/var\/run\/secrets\/kubernetes\.io\/serviceaccount\/ca\.crt/,
  );
});

test("with platform-dns on the sign-in proxy and the backend read their trust from the local CA ConfigMap, read-only", async () => {
  const output = renderPortal(withDns(await loadRepository("local"), true));
  // The ConfigMap is a volume of the pod, projecting only the two public keys.
  assert.match(
    output,
    /volumes:\s+(?:#[^\n]*\s+)?- name: local-ca\s+configMap:\s+name: kore-local-ca\s+items:\s+- key: ca\.crt\s+path: ca\.crt\s+- key: bundle\.crt\s+path: bundle\.crt/,
  );
  // The proxy adds it to the roots it verifies the issuer with.
  assert.match(output, /- --provider-ca-file=\/etc\/kore\/local-ca\/ca\.crt/);
  // The backend's single extra-CA file is the bundle holding the cluster CA too.
  assert.match(
    output,
    /NODE_EXTRA_CA_CERTS\s+value: \/etc\/kore\/local-ca\/bundle\.crt/,
  );
  assert.doesNotMatch(output, /serviceaccount\/ca\.crt/);
  // Both containers mount it, read-only.
  const mounts = output.match(
    /- \{?name: local-ca,? mountPath: \/etc\/kore\/local-ca,? readOnly: true\}?|- name: local-ca\s+mountPath: \/etc\/kore\/local-ca\s+readOnly: true/g,
  );
  assert.equal(mounts?.length, 2);
});

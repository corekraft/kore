import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  featureEnabled,
  loadRepository,
  platformDnsFlag,
  platformHelmArgs,
  platformPlan,
  validateRepository,
} from "../../src/config/index.js";

// Docs: infra/catalog/compatibility.md (the platform DNS row)

const run = promisify(execFile);
const chartPath = "infra/charts/platform-dns";

for (const name of ["local", "managed-example"]) {
  test(`${name} declares platform-dns off, so no platform DNS server is ever installed`, async () => {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    assert.equal(repository.environment.features?.[platformDnsFlag], false);
    assert.equal(
      featureEnabled(repository.environment, platformDnsFlag),
      false,
    );
    assert.equal(
      enabledComponents(repository).some((c) => c.name === "kore-platform-dns"),
      false,
    );
  });
}

test("the platform DNS component is a flag-gated local chart in its own namespace", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-dns",
  );
  assert.equal(component?.featureFlag, platformDnsFlag);
  assert.equal(component?.kind, "local-chart");
  assert.equal(component?.chart, chartPath);
  assert.equal(component?.namespace, "kore-dns");
  assert.deepEqual(component?.ownsCRDs, []);
  const on = {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, [platformDnsFlag]: true },
    },
  };
  assert.equal(
    enabledComponents(on).some((c) => c.name === "kore-platform-dns"),
    true,
  );
});

test("the DNS server image is pinned by digest, approved with evidence, and named by the component", async () => {
  const repository = await loadRepository("local");
  const images = repository.approved.images.filter(
    (i) => i.component === "kore-platform-dns",
  );
  assert.equal(images.length, 1);
  const [image] = images;
  assert.equal(image?.name, "platform-dns");
  assert.match(
    image?.image ?? "",
    /^docker\.io\/coredns\/coredns:1\.14\.7@sha256:[0-9a-f]{64}$/,
  );
  assert.equal(image?.evidence.method, "registry-digest");
  assert.equal(repository.versions.images["platform-dns"], image?.image);
});

const localDomain = async (): Promise<string> =>
  platformPlan((await loadRepository("local")).environment).domain;

async function render(zone?: string): Promise<string> {
  const repository = await loadRepository("local");
  const args = zone === undefined ? [] : ["--set-string", `zone=${zone}`];
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-dns",
    join(repository.root, chartPath),
    "--namespace",
    "kore-dns",
    ...args,
  ]);
  return stdout;
}

test("the zone comes from the platform domain field, so the chart refuses to render without one", async () => {
  const repository = await loadRepository("local");
  const [, zone] = platformHelmArgs(
    repository.environment,
    "kore-platform-dns",
  );
  assert.equal(zone, `zone=${await localDomain()}`);
  await assert.rejects(render(), /zone/);
});

test("a name in the zone answers the loopback address, and a different domain moves the zone", async () => {
  const rendered = await render("example.test");
  assert.match(rendered, /template IN A example\.test \{/);
  assert.match(rendered, /match "\^\(\.\+\\\.\)\?example\\\.test\\\.\$"/);
  assert.match(rendered, /answer "\{\{ \.Name \}\} 60 IN A 127\.0\.0\.1"/);
  assert.equal(rendered.includes(await localDomain()), false);
});

test("an IPv6 query in the zone gets an empty NOERROR answer, so resolvers fall back to IPv4 without a delay", async () => {
  const domain = await localDomain();
  const rendered = await render(domain);
  assert.ok(rendered.includes(`template IN AAAA ${domain} {`));
  const block = rendered.slice(rendered.indexOf("template IN AAAA"));
  assert.match(block.split("}")[0] ?? "", /rcode NOERROR/);
  assert.equal(/answer .*AAAA/.test(rendered), false);
});

test("the server forwards nothing and answers only its zone", async () => {
  const domain = await localDomain();
  const rendered = await render(domain);
  assert.equal(/^\s*forward\b/m.test(rendered), false);
  assert.ok(rendered.includes(`${domain}:1053 {`));
});

test("the pod is admitted by container security: non-root, read-only, no capabilities, with probes and limits", async () => {
  const domain = await localDomain();
  const rendered = await render(domain);
  assert.match(
    rendered,
    /image: docker\.io\/coredns\/coredns:1\.14\.7@sha256:[0-9a-f]{64}/,
  );
  for (const needle of [
    "runAsNonRoot: true",
    "readOnlyRootFilesystem: true",
    "allowPrivilegeEscalation: false",
    "drop: [ALL]",
    // The image binary carries a file capability; without it the exec is refused.
    "add: [NET_BIND_SERVICE]",
    "type: RuntimeDefault",
    "automountServiceAccountToken: false",
    "readinessProbe:",
    "livenessProbe:",
    "limits:",
  ]) {
    assert.ok(rendered.includes(needle), needle);
  }
});

test("the Service is cluster-internal on port 53 over UDP and TCP", async () => {
  const domain = await localDomain();
  const rendered = await render(domain);
  const service = rendered
    .split(/^---$/m)
    .find((d) => /^kind: Service$/m.test(d));
  assert.ok(service);
  assert.match(service, /type: ClusterIP/);
  assert.match(service, /protocol: UDP/);
  assert.match(service, /protocol: TCP/);
  assert.match(service, /port: 53/);
});

test("only the local environment can turn platform-dns on, so a provider's DNS is never replaced", async () => {
  const repository = await loadRepository("managed-example");
  assert.notEqual(repository.environment.provider, "k3d");
  assert.equal(repository.environment.features?.[platformDnsFlag], false);
});

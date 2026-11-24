import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1551. Each service gets a Service and a ServiceAccount named exactly like it.
// The Service selects the BFF pods, or the frontend pods when the service has no BFF, so
// <service>.<suborg>.svc.cluster.local reaches the service. The ServiceAccount is shared by the
// service's components and mounts no API token, so a grant can name a stable identity. The
// existing <service>-bff and <service>-frontend Services stay as they are. All of it renders only
// while the golden-path-service-identity flag is on, which the ApplicationSet passes to the chart
// as serviceIdentity; with the flag off the render is unchanged.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
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

const service = ["--set", "service=auth"];
const both = [
  ...service,
  "--set",
  `frontend.image=${frontend}`,
  "--set",
  `bff.image=${bff}`,
];
const frontendOnly = [...service, "--set", `frontend.image=${frontend}`];
const bffOnly = [...service, "--set", `bff.image=${bff}`];
const identityOn = ["--set", "serviceIdentity=true"];

const named = (docs: string[], kind: string, name: string) =>
  docs.find(
    (doc) =>
      new RegExp(`^kind: ${kind}$`, "m").test(doc) &&
      doc.includes(`\n  name: ${name}\n`),
  ) ?? "";

const deployments = (docs: string[]) =>
  docs.filter((doc) => /^kind: Deployment$/m.test(doc));

test("with both components the service's Service selects the BFF pods on port 80", async () => {
  const docs = await render(...both, ...identityOn);
  const found = named(docs, "Service", "auth");
  expect(found).toContain("    app.kubernetes.io/name: auth-bff\n");
  expect(found).toContain("      port: 80\n");
  expect(found).toContain("      targetPort: http\n");
});

test("with only a frontend the service's Service selects the frontend pods", async () => {
  const docs = await render(...frontendOnly, ...identityOn);
  expect(named(docs, "Service", "auth")).toContain(
    "    app.kubernetes.io/name: auth-frontend\n",
  );
  expect(named(docs, "Deployment", "auth-bff")).toBe("");
});

test("with only a BFF the service's Service selects the BFF pods", async () => {
  const docs = await render(...bffOnly, ...identityOn);
  expect(named(docs, "Service", "auth")).toContain(
    "    app.kubernetes.io/name: auth-bff\n",
  );
  expect(named(docs, "Deployment", "auth-frontend")).toBe("");
});

test("the per-component Services keep their names and selectors beside the service's Service", async () => {
  const docs = await render(...both, ...identityOn);
  expect(named(docs, "Service", "auth-bff")).toContain(
    "    app.kubernetes.io/name: auth-bff\n",
  );
  expect(named(docs, "Service", "auth-frontend")).toContain(
    "    app.kubernetes.io/name: auth-frontend\n",
  );
});

test("a ServiceAccount named after the service is rendered with no API token mounted", async () => {
  for (const set of [both, frontendOnly, bffOnly]) {
    const docs = await render(...set, ...identityOn);
    const account = named(docs, "ServiceAccount", "auth");
    expect(account).not.toBe("");
    expect(account).toContain("automountServiceAccountToken: false\n");
  }
});

test("every Deployment runs as the service's ServiceAccount with its token not mounted", async () => {
  for (const set of [both, frontendOnly, bffOnly]) {
    const docs = await render(...set, ...identityOn);
    expect(deployments(docs).length).toBeGreaterThan(0);
    for (const doc of deployments(docs)) {
      expect(doc).toContain("      serviceAccountName: auth\n");
      expect(doc).toContain("      automountServiceAccountToken: false\n");
    }
  }
});

test("a service with neither component is refused, since it would have no pods for its Service", async () => {
  await expect(render(...service, ...identityOn)).rejects.toThrow();
});

test("with the flag off the render has no Service or ServiceAccount named after the service and no serviceAccountName in any pod spec", async () => {
  for (const set of [both, frontendOnly, bffOnly]) {
    const docs = await render(...set);
    expect(named(docs, "Service", "auth")).toBe("");
    expect(named(docs, "ServiceAccount", "auth")).toBe("");
    expect(deployments(docs).length).toBeGreaterThan(0);
    for (const doc of deployments(docs)) {
      expect(doc).not.toContain("serviceAccountName");
      expect(doc).not.toContain("automountServiceAccountToken");
    }
  }
});

test("a service with neither component is refused with the flag off too", async () => {
  await expect(render(...service)).rejects.toThrow();
});

test("the ApplicationSet passes serviceIdentity to each workload only while golden-path-service-identity is on", async () => {
  const root = await findRoot();
  const delivery = async (...set: string[]) =>
    (
      await run("helm", [
        "template",
        "golden-path-delivery",
        join(root, "infra/charts/golden-path-delivery"),
        "--set",
        "repoURL=https://github.com/corekraft/kore.git",
        "--set",
        `revision=${"c".repeat(40)}`,
        "--set",
        "environment=local",
        "--set-json",
        `templateImages=${JSON.stringify({
          "static-frontend": {
            image: "ghcr.io/o/fe",
            digest: `sha256:${"1".repeat(64)}`,
          },
          "kotlin-bff": {
            image: "ghcr.io/o/bff",
            digest: `sha256:${"2".repeat(64)}`,
          },
        })}`,
        ...set,
      ])
    ).stdout;
  expect(await delivery("--set", "serviceIdentity=true")).toMatch(
    /name: serviceIdentity\s+value: "true"/,
  );
  expect(await delivery()).not.toContain("serviceIdentity");
});

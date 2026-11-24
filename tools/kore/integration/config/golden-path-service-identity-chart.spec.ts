import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1551. Each service gets a Service and a ServiceAccount named exactly like it.
// The Service selects the BFF pods, or the frontend pods when the service has no BFF, so
// <service>.<suborg>.svc.cluster.local reaches the service. The ServiceAccount is shared by the
// service's components and mounts no API token, so a grant can name a stable identity. The
// existing <service>-bff and <service>-frontend Services stay as they are.

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

const named = (docs: string[], kind: string, name: string) =>
  docs.find(
    (doc) =>
      new RegExp(`^kind: ${kind}$`, "m").test(doc) &&
      doc.includes(`\n  name: ${name}\n`),
  ) ?? "";

const deployments = (docs: string[]) =>
  docs.filter((doc) => /^kind: Deployment$/m.test(doc));

test("with both components the service's Service selects the BFF pods on port 80", async () => {
  const docs = await render(...both);
  const found = named(docs, "Service", "auth");
  expect(found).toContain("    app.kubernetes.io/name: auth-bff\n");
  expect(found).toContain("      port: 80\n");
  expect(found).toContain("      targetPort: http\n");
});

test("with only a frontend the service's Service selects the frontend pods", async () => {
  const docs = await render(...frontendOnly);
  expect(named(docs, "Service", "auth")).toContain(
    "    app.kubernetes.io/name: auth-frontend\n",
  );
  expect(named(docs, "Deployment", "auth-bff")).toBe("");
});

test("with only a BFF the service's Service selects the BFF pods", async () => {
  const docs = await render(...bffOnly);
  expect(named(docs, "Service", "auth")).toContain(
    "    app.kubernetes.io/name: auth-bff\n",
  );
  expect(named(docs, "Deployment", "auth-frontend")).toBe("");
});

test("the per-component Services keep their names and selectors beside the service's Service", async () => {
  const docs = await render(...both);
  expect(named(docs, "Service", "auth-bff")).toContain(
    "    app.kubernetes.io/name: auth-bff\n",
  );
  expect(named(docs, "Service", "auth-frontend")).toContain(
    "    app.kubernetes.io/name: auth-frontend\n",
  );
});

test("a ServiceAccount named after the service is rendered with no API token mounted", async () => {
  for (const set of [both, frontendOnly, bffOnly]) {
    const docs = await render(...set);
    const account = named(docs, "ServiceAccount", "auth");
    expect(account).not.toBe("");
    expect(account).toContain("automountServiceAccountToken: false\n");
  }
});

test("every Deployment runs as the service's ServiceAccount with its token not mounted", async () => {
  for (const set of [both, frontendOnly, bffOnly]) {
    const docs = await render(...set);
    expect(deployments(docs).length).toBeGreaterThan(0);
    for (const doc of deployments(docs)) {
      expect(doc).toContain("      serviceAccountName: auth\n");
      expect(doc).toContain("      automountServiceAccountToken: false\n");
    }
  }
});

test("a service with neither component is refused, since it would have no pods for its Service", async () => {
  await expect(render(...service)).rejects.toThrow();
});

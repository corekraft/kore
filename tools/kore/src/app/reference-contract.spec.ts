import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../config/config.js";

// Docs: docs/decisions/0012-environment-overlays-hold-provider-specifics.md
// Offline contract of the reference application charts: what the Step 12
// smoke and negative tests assume is rendered, proven without a cluster.

const run = promisify(execFile);
const digest = "sha256:" + "a".repeat(64);
const registry = "registry.kore.local:30500";

async function chartPath(name: "workload" | "resources"): Promise<string> {
  return join(await findRoot(), "apps/reference/charts", name);
}

async function render(
  name: "workload" | "resources",
  hostname: string,
  ...set: string[]
): Promise<{ text: string }> {
  const { stdout } = await run("helm", [
    "template",
    `reference-${name}`,
    await chartPath(name),
    "--namespace",
    "reference",
    "--set",
    `platform.gateway.hostname=${hostname}`,
    ...set,
  ]);
  return { text: stdout };
}

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? files(join(directory, entry.name))
        : [join(directory, entry.name)],
    ),
  );
  return nested.flat();
}

function documents(text: string, kind: string): string[] {
  return text
    .split(/^---$/m)
    .filter((part) => new RegExp(`^kind: ${kind}$`, "m").test(part));
}

test("the charts render identically in every environment except the gateway hostname", async () => {
  for (const name of ["workload", "resources"] as const) {
    const local = (await render(name, "kore.local")).text;
    const elsewhere = (await render(name, "app.example.com")).text;

    assert.equal(
      elsewhere,
      local.replaceAll("kore.local", "app.example.com"),
      `${name} must differ between environments only by hostname`,
    );
  }
});

test("chart sources hold no provider-specific templates, values, or hostnames", async () => {
  const provider =
    /minikube|nodeport|loadbalancer|hostpath|storageclassname|ingressclass|\.amazonaws\.|\.azure\.|gke\.|hcloud|digitalocean|kore\.local|127\.0\.0\.1/i;
  for (const name of ["workload", "resources"] as const) {
    for (const file of await files(await chartPath(name))) {
      assert.doesNotMatch(
        await readFile(file, "utf8"),
        provider,
        `${file} must leave provider specifics to the environment overlay`,
      );
    }
  }
});

test("each workload runs as its own ServiceAccount, never the namespace default", async () => {
  const { text } = await render("workload", "kore.local");
  const accounts = documents(text, "ServiceAccount").map(
    (doc) => /^ {2}name: (.+)$/m.exec(doc)![1]!,
  );
  const used = [
    ...documents(text, "Deployment"),
    ...documents(text, "Job"),
  ].map((doc) => /serviceAccountName: (.+)$/m.exec(doc)![1]!);

  assert.deepEqual(accounts.sort(), [
    "reference-api",
    "reference-frontend",
    "reference-migrate",
  ]);
  assert.deepEqual(used.sort(), accounts);
  assert.equal(new Set(used).size, used.length, "no two workloads share one");
  assert.doesNotMatch(text, /serviceAccountName: default/);
  assert.equal(
    (text.match(/automountServiceAccountToken: false/g) ?? []).length,
    accounts.length * 2,
    "no workload mounts a Kubernetes API token",
  );
});

test("no chart holds a Secret value: credentials arrive only through ExternalSecret and secretKeyRef", async () => {
  const workload = (await render("workload", "kore.local")).text;
  const resources = (await render("resources", "kore.local")).text;

  assert.equal(documents(workload + resources, "Secret").length, 0);
  assert.equal(documents(resources, "ExternalSecret").length, 1);
  for (const line of workload
    .split("\n")
    .filter((l) => /PASSWORD|TOKEN|PGUSER/.test(l) && l.includes("{name:"))) {
    assert.match(line, /secretKeyRef/, `${line.trim()} must use secretKeyRef`);
    assert.doesNotMatch(line, /\bvalue:/);
  }
});

test("a digest-qualified image is deployed by digest and never by tag", async () => {
  const { text } = await render(
    "workload",
    "kore.local",
    "--set",
    `image.repository=${registry}/reference`,
    "--set",
    `image.digest=${digest}`,
  );
  const images = [...text.matchAll(/^\s+image: "(.+)"$/gm)].map((m) => m[1]);

  assert.equal(images.length, 3, "two Deployments and the migration Job");
  for (const image of images) {
    assert.equal(image, `${registry}/reference@${digest}`);
  }
});

test("the rendered policy matches what the smoke tests exercise: mTLS, deny-by-default, native and OPA authorization", async () => {
  const { text } = await render("workload", "kore.local");

  assert.match(text, /kind: HTTPRoute/);
  assert.match(text, /mtls: \{mode: STRICT\}/);
  const policies = documents(text, "AuthorizationPolicy");
  const named = (name: string) =>
    policies.find((doc) => new RegExp(`name: ${name}\\}?$`, "m").test(doc))!;
  assert.match(named("api-default-deny"), /spec: \{selector:/);
  assert.doesNotMatch(named("api-default-deny"), /rules:/);
  assert.match(named("api-allow-frontend-l7"), /sa\/reference-frontend/);
  assert.match(named("api-opa-protected"), /action: CUSTOM/);
  assert.match(named("api-opa-protected"), /name: opa-authorizer/);
  assert.match(named("api-opa-protected"), /\/api\/protected/);
});

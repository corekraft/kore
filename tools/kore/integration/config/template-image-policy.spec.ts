import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0045-static-frontends-as-signed-images.md (the template images),
// infra/plans/15-next-horizon.md Step 4 (issue 1884).

const run = promisify(execFile);
const issuer = "https://token.actions.githubusercontent.com";
const subject =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.22.0";
const templateFlag = "golden-path-template-admission";

async function render(
  trust: Record<string, unknown>,
  features: Record<string, boolean> = {},
  sets: string[] = [],
): Promise<string[]> {
  const root = await findRoot();
  const args = [
    "template",
    "kore-image-policy",
    join(root, "infra/charts/image-policy"),
    "--set-string",
    "platform.registry.address=registry.example:5000",
    "--set-json",
    `trust=${JSON.stringify(trust)}`,
  ];
  for (const [flag, on] of Object.entries(features)) {
    args.push("--set", `features.${flag}=${on}`);
  }
  for (const set of sets) {
    args.push("--set", set);
  }
  const { stdout } = await run("helm", args);
  return stdout.split(/^---$/m);
}

const keyless = (mode = "warn") => ({
  type: "keyless",
  mode,
  issuer,
  subjects: [subject],
});

const templatePolicy = (docs: string[]) =>
  docs.find((doc) => doc.includes("name: kore-template-images")) ?? "";

test("with the flag on and keyless trust, a template policy admits the template repository only under the release identity", async () => {
  const policy = templatePolicy(
    await render(keyless(), { [templateFlag]: true }),
  );
  assert.ok(policy.includes("kind: ClusterImagePolicy"), "policy rendered");
  assert.ok(
    policy.includes('glob: "ghcr.io/corekraft/kore/templates/**"'),
    "glob names the template repository",
  );
  assert.ok(policy.includes("keyless:"), "authority is keyless");
  assert.ok(
    policy.includes(`issuer: "${issuer}"`),
    "identity uses the GitHub Actions issuer",
  );
  assert.ok(
    policy.includes(`subject: "${subject}"`),
    "identity is the exact release subject",
  );
  assert.ok(
    !policy.includes("static:"),
    "no static pass admits unsigned images",
  );
});

test("the template policy audits by default, whatever the platform's trust mode, so enforcing the platform does not enforce the templates", async () => {
  const policy = templatePolicy(
    await render(keyless("enforce"), { [templateFlag]: true }),
  );
  assert.match(policy, /mode: warn/);
});

test("the template policy enforces only when templates.mode says so", async () => {
  const policy = templatePolicy(
    await render(keyless("warn"), { [templateFlag]: true }, [
      "templates.mode=enforce",
    ]),
  );
  assert.match(policy, /mode: enforce/);
});

test("the template policy reads its signatures through the trust signaturePullSecret, as the platform policy does", async () => {
  const withSecret = templatePolicy(
    await render(
      { ...keyless(), signaturePullSecret: "kore-registry-read" },
      { [templateFlag]: true },
    ),
  );
  assert.ok(
    withSecret.includes('- name: "kore-registry-read"'),
    "names the pull secret as a signature source",
  );
  const without = templatePolicy(
    await render(keyless(), { [templateFlag]: true }),
  );
  assert.ok(!without.includes("signaturePullSecrets"), "no source without one");
});

test("with the flag off, no template policy is rendered, so the flag-off render is unchanged", async () => {
  const docs = await render(keyless());
  assert.equal(templatePolicy(docs), "");
  const off = await render(keyless(), { [templateFlag]: false });
  assert.equal(templatePolicy(off), "");
});

test("a key authority never gets a template policy, since the templates are signed keylessly by the release", async () => {
  const keyTrust = {
    type: "key",
    mode: "warn",
    keyRef: { name: "kore-local-signing-pub", namespace: "cosign-system" },
  };
  const docs = await render(keyTrust, { [templateFlag]: true });
  assert.equal(templatePolicy(docs), "");
});

test("the platform and upstream policies are rendered unchanged beside the template policy", async () => {
  const docs = await render(keyless(), { [templateFlag]: true });
  assert.ok(docs.some((d) => d.includes("name: kore-platform-images")));
  assert.ok(docs.some((d) => d.includes("name: kore-upstream-images")));
});

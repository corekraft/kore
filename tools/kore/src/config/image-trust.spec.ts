import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository, validateRepository } from "./config.js";
import { helmUpgradeArgs } from "../platform/helm.js";
import type { Repository } from "./types.js";

const releaseSubject =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.1.1";
const issuer = "https://token.actions.githubusercontent.com";

type Trust = Record<string, unknown>;

async function withTrust(
  environment: string,
  change: (trust: Trust | undefined) => Trust | undefined,
): Promise<Repository> {
  const base = await loadRepository(environment);
  const overlay = base.imageTrustValues ?? {};
  return {
    ...base,
    imageTrustValues: { ...overlay, trust: change(overlay.trust as Trust) },
  };
}

const keyless = (over: Trust = {}): Trust => ({
  type: "keyless",
  mode: "warn",
  issuer,
  subjects: [releaseSubject],
  ...over,
});

test("local trusts its local signing key and managed-example a pinned release workflow", async () => {
  const local = await loadRepository("local");
  assert.deepEqual(local.imageTrustValues?.["trust"], {
    type: "key",
    mode: "warn",
    keyRef: { name: "kore-local-signing-pub", namespace: "cosign-system" },
  });
  const managed = await loadRepository("managed-example");
  assert.deepEqual(managed.imageTrustValues?.trust, keyless());
  await validateRepository(local);
  await validateRepository(managed);
});

test("every managed-example subject is the release workflow's real identity on an exact tag", async () => {
  const { root } = await loadRepository("local");
  const workflow = await readFile(
    join(root, ".github", "workflows", "release.yaml"),
    "utf8",
  );
  const template = /^ {6}IDENTITY: (\S+)\$\{\{ github\.ref_name \}\}$/m.exec(
    workflow,
  )?.[1];
  assert.ok(template, "release.yaml declares IDENTITY from the pushed tag");
  const managed = await loadRepository("managed-example");
  const subjects = managed.imageTrustValues?.["trust"] as Trust;
  const listed = subjects["subjects"] as string[];
  assert.ok(listed.length > 0);
  for (const subject of listed) {
    assert.ok(subject.startsWith(template), subject);
    assert.match(subject.slice(template.length), /^v\d+\.\d+\.\d+$/);
  }
});

test("a missing authority is rejected with the fix", async () => {
  const repository = await withTrust("local", () => undefined);
  await assert.rejects(
    validateRepository(repository),
    /image trust authority is required.*type: key or keyless/is,
  );
});

test("regexp identities are rejected so no other workflow or branch is admitted", async () => {
  for (const extra of [
    { subjectRegExp: ".*" },
    { issuerRegExp: "https://.*" },
  ]) {
    const repository = await withTrust("managed-example", () => keyless(extra));
    await assert.rejects(
      validateRepository(repository),
      /regexp.*not allowed/i,
    );
  }
});

test("wildcard, branch, pull-request, and foreign-repository subjects are rejected", async () => {
  const base =
    "https://github.com/corekraft/kore/.github/workflows/release.yaml";
  for (const subject of [
    `${base}@refs/tags/v*`,
    `${base}@refs/heads/main`,
    `${base}@refs/pull/12/merge`,
    "https://github.com/evil/kore/.github/workflows/release.yaml@refs/tags/v0.1.0",
    "https://github.com/corekraft/kore/.github/workflows/check.yml@refs/heads/main",
  ]) {
    const repository = await withTrust("managed-example", () =>
      keyless({ subjects: [subject] }),
    );
    await assert.rejects(
      validateRepository(repository),
      /subject.*exact.*corekraft\/kore.*refs\/tags\/v/is,
      subject,
    );
  }
});

test("keyless requires the GitHub Actions issuer and at least one subject", async () => {
  await assert.rejects(
    validateRepository(
      await withTrust("managed-example", () =>
        keyless({ issuer: "https://accounts.example.com", subjects: [] }),
      ),
    ),
    (error: Error) => {
      assert.match(error.message, /issuer must be https:\/\/token\.actions/);
      assert.match(error.message, /at least one exact subject/);
      return true;
    },
  );
});

test("a key authority must reference a key and cannot also be keyless", async () => {
  await assert.rejects(
    validateRepository(
      await withTrust("local", (trust) => ({
        ...trust,
        keyRef: undefined,
        issuer,
        subjects: [releaseSubject],
      })),
    ),
    (error: Error) => {
      assert.match(error.message, /key authority needs keyRef\.name/);
      assert.match(error.message, /must not also set keyless/);
      return true;
    },
  );
});

test("a registry address that covers a seed image or everything is rejected", async () => {
  for (const address of ["docker.io", "ghcr.io", "cgr.dev"]) {
    const base = await loadRepository("managed-example");
    await assert.rejects(
      validateRepository({
        ...base,
        environment: { ...base.environment, registry: { address } },
      }),
      /glob .*\/\*\* covers seed/is,
      address,
    );
  }
});

test("a committed images list is rejected because the glob is derived from registry.address", async () => {
  const repository = await withTrust("local", (trust) => ({
    ...trust,
    images: ["10.96.0.50:5000/**"],
  }));
  await assert.rejects(
    validateRepository(repository),
    /images is derived from registry\.address/,
  );
});

test("the chart renders ClusterImagePolicy for all containers without regexps or namespace opt-in", async () => {
  const root = await findRoot();
  const dir = join(root, "infra/charts/image-policy/templates");
  const text = await readFile(join(dir, "clusterimagepolicy.yaml"), "utf8");
  assert.match(text, /kind: ClusterImagePolicy/);
  assert.match(text, /apiVersion: policy\.sigstore\.dev\/v1beta1/);
  // A match on pods alone would leave Deployments and Jobs unmatched (the
  // webhook evaluates the kind it is handed) and rejected as "no matching policies".
  assert.doesNotMatch(text, /^\s*match:/m);
  assert.match(text, /\.Values\.trust\.issuer/);
  assert.doesNotMatch(text, /RegExp/i);
  assert.doesNotMatch(text, /static:/);
  assert.doesNotMatch(text, /policy\.sigstore\.dev\/include/);
});

test("no namespace is opted into enforcement yet", async () => {
  const root = await findRoot();
  for (const dir of ["infra/charts", "infra/environments"]) {
    const files = (await readdir(join(root, dir), { recursive: true })).filter(
      (f) => /\.(ya?ml|tpl)$/.test(f),
    );
    for (const file of files) {
      const body = await readFile(join(root, dir, file), "utf8");
      assert.doesNotMatch(
        body,
        /policy\.sigstore\.dev\/include/,
        `${dir}/${file} opts a namespace in before audit`,
      );
    }
  }
});

test("a key reference outside the policy-controller namespace is rejected with the fix", async () => {
  const repository = await withTrust("local", (trust) => ({
    ...trust,
    keyRef: { name: "kore-local-signing-pub", namespace: "kore-system" },
  }));
  await assert.rejects(validateRepository(repository), (error: Error) => {
    assert.match(error.message, /keyRef\.namespace must be cosign-system/);
    assert.match(error.message, /policy-controller/);
    return true;
  });
});

test("trust.mode must be warn or enforce so a typo cannot silently disable the audit", async () => {
  for (const mode of [undefined, "audit", "Enforce", ""]) {
    const repository = await withTrust("local", (trust) => ({
      ...trust,
      mode,
    }));
    await assert.rejects(
      validateRepository(repository),
      /image trust: mode must be warn or enforce/,
      String(mode),
    );
  }
  for (const mode of ["warn", "enforce"]) {
    await validateRepository(
      await withTrust("local", (trust) => ({ ...trust, mode })),
    );
  }
});

const run = promisify(execFile);

async function render(
  environment: string,
  mode: string,
): Promise<{ platform: string; upstream: string }> {
  const root = await findRoot();
  const repository = await loadRepository(environment);
  const trust = { ...(repository.imageTrustValues?.trust as Trust), mode };
  const { stdout } = await run("helm", [
    "template",
    "kore-image-policy",
    join(root, "infra/charts/image-policy"),
    "--set-string",
    "platform.registry.address=registry.example:5000",
    "--set-json",
    `trust=${JSON.stringify(trust)}`,
  ]);
  const docs = stdout.split(/^---$/m);
  return {
    platform: docs.find((d) => d.includes("name: kore-platform-images")) ?? "",
    upstream: docs.find((d) => d.includes("name: kore-upstream-images")) ?? "",
  };
}

test("the platform policy renders the environment trust mode for every environment", async () => {
  for (const environment of ["local", "managed-example"]) {
    for (const mode of ["warn", "enforce"]) {
      const { platform, upstream } = await render(environment, mode);
      assert.match(platform, new RegExp(`mode: ${mode}\\b`), environment);
      assert.match(upstream, new RegExp(`mode: ${mode}\\b`), environment);
    }
  }
});

test("both policies apply to every workload kind the webhook evaluates, not only pods", async () => {
  const { platform, upstream } = await render("local", "warn");
  for (const policy of [platform, upstream]) {
    assert.doesNotMatch(policy, /^\s*match:/m);
    assert.doesNotMatch(policy, /resource: pods/);
  }
});

test("policy controller's no-match behavior follows trust.mode: warn while auditing, deny when enforcing", async () => {
  for (const [mode, policy] of [
    ["warn", "warn"],
    ["enforce", "deny"],
  ] as const) {
    const repository = await withTrust("local", (trust) => ({
      ...trust,
      mode,
    }));
    const component = repository.catalog.components!.find(
      (c) => c.name === "policy-controller",
    )!;
    const args = helmUpgradeArgs(repository, component);
    const at = args.indexOf(`webhook.configData.no-match-policy=${policy}`);
    assert.notEqual(at, -1, mode);
    assert.equal(args[at - 1], "--set-string");
  }
});

test("an unrecognised trust.mode never relaxes the no-match policy", async () => {
  const repository = await withTrust("local", (trust) => ({
    ...trust,
    mode: "audit",
  }));
  const component = repository.catalog.components!.find(
    (c) => c.name === "policy-controller",
  )!;
  assert.ok(
    helmUpgradeArgs(repository, component).includes(
      "webhook.configData.no-match-policy=deny",
    ),
  );
});

test("upstream images get their own static policy and never widen the internal-image policy", async () => {
  const { platform, upstream } = await render("local", "enforce");
  // Internal images: signature required, never a static pass.
  assert.doesNotMatch(platform, /static:/);
  assert.match(platform, /registry\.example:5000\/\*\*/);
  assert.doesNotMatch(platform, /proxyv2|cloudnative-pg/);
  // Upstream images (waypoint, CloudNativePG) are named exactly, not by wildcard host.
  assert.match(upstream, /static:\s*\n\s*action: pass/);
  assert.match(upstream, /istio\/proxyv2/);
  assert.match(upstream, /ghcr\.io\/cloudnative-pg\/postgresql/);
  assert.doesNotMatch(upstream, /registry\.example/);
  assert.doesNotMatch(upstream, /glob: "?(\*\*|\*)"?\s*$/m);
});

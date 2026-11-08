import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository, validateRepository } from "./config.js";
import type { Repository } from "./types.js";

const releaseSubject =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.1.0";
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
  issuer,
  subjects: [releaseSubject],
  ...over,
});

test("local trusts its local signing key and managed-example a pinned release workflow", async () => {
  const local = await loadRepository("local");
  assert.deepEqual(local.imageTrustValues?.["trust"], {
    type: "key",
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
  const text = (
    await Promise.all(
      (await readdir(dir)).map((f) => readFile(join(dir, f), "utf8")),
    )
  ).join("\n");
  assert.match(text, /kind: ClusterImagePolicy/);
  assert.match(text, /apiVersion: policy\.sigstore\.dev\/v1beta1/);
  assert.match(text, /group: ""\s+version: v1\s+resource: pods/);
  assert.match(text, /\.Values\.trust\.issuer/);
  assert.doesNotMatch(text, /RegExp/i);
  assert.doesNotMatch(text, /static:\s*\n\s*action: pass/);
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

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository, validateRepository } from "./config.js";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0028-image-trust-authority.md (exit criterion: unsigned
// and unauthorized-identity images are rejected)

const run = promisify(execFile);
const issuer = "https://token.actions.githubusercontent.com";
const workflow =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml";

/** Identity forms that must never be admitted. Tests only; never an overlay. */
const unauthorizedSubjects = {
  "a developer's workflow on a branch": `${workflow}@refs/heads/main`,
  "a feature branch build": `${workflow}@refs/heads/feat/anything`,
  "a pull request build": `${workflow}@refs/pull/12/merge`,
  "a build job of another repository": `https://github.com/someone-else/kore/.github/workflows/release.yaml@refs/tags/v0.1.1`,
  "another workflow file on a tag": `https://github.com/corekraft/kore/.github/workflows/build.yaml@refs/tags/v0.1.1`,
  "a developer's mailbox identity": "developer@example.com",
} as const;

interface Identity {
  issuer: string;
  subject?: string;
  subjectRegExp?: string;
  issuerRegExp?: string;
}

interface Authority {
  name: string;
  keyless?: { identities: Identity[] };
  key?: { secretRef: { name: string; namespace: string } };
}

async function renderPlatformImages(
  repository: Repository,
): Promise<Authority[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-image-policy",
    join(root, "infra/charts/image-policy"),
    "--set-string",
    "platform.registry.address=registry.example:5000",
    "--set-json",
    `trust=${JSON.stringify(repository.imageTrustValues?.["trust"])}`,
  ]);
  const document = stdout
    .split(/^---$/m)
    .find((d) => d.includes("name: kore-platform-images"));
  assert.ok(document, "the chart renders kore-platform-images");
  // helm renders flow-free JSON-compatible YAML only for the keys below, so
  // the authority list is read from the rendered text without a YAML parser.
  return parseAuthorities(document);
}

/** Minimal reader for the authorities block this chart renders. */
function parseAuthorities(document: string): Authority[] {
  const block = document.split(/^ {2}authorities:\n/m)[1] ?? "";
  const authorities: Authority[] = [];
  let current: Authority | undefined;
  let identity: Identity | undefined;
  for (const line of block.split("\n")) {
    const name = /^ {4}- name: (\S+)/.exec(line)?.[1];
    if (name) {
      current = { name };
      authorities.push(current);
      identity = undefined;
      continue;
    }
    if (!current) {
      continue;
    }
    if (/^ {6}keyless:/.test(line)) {
      current.keyless = { identities: [] };
    }
    const entry = /^ {10}- (issuer|issuerRegExp): "(.*)"$/.exec(line);
    if (entry && current.keyless) {
      identity = { issuer: "" };
      identity[entry[1] as "issuer" | "issuerRegExp"] = entry[2]!;
      current.keyless.identities.push(identity);
      continue;
    }
    const field = /^ {12}(subject|subjectRegExp): "(.*)"$/.exec(line);
    if (field && identity) {
      identity[field[1] as "subject" | "subjectRegExp"] = field[2]!;
    }
    const secret = /^ {10}(name|namespace): "(.*)"$/.exec(line);
    if (secret && /^ {6}key:/m.test(block)) {
      current.key ??= { secretRef: { name: "", namespace: "" } };
      current.key.secretRef[secret[1] as "name" | "namespace"] = secret[2]!;
    }
  }
  return authorities;
}

/** What the verifier does with an identity: exact issuer and subject match only. */
function admits(identities: Identity[], candidate: Identity): boolean {
  return identities.some(
    (allowed) =>
      allowed.subject !== undefined &&
      allowed.issuer === candidate.issuer &&
      allowed.subject === candidate.subject,
  );
}

test("managed-example admits only the exact release subjects and issuer, with no regexp", async () => {
  const repository = await loadRepository("managed-example");
  const trust = repository.imageTrustValues?.["trust"] as {
    subjects: string[];
  };
  const authorities = await renderPlatformImages(repository);

  assert.deepEqual(
    authorities.map(({ name }) => name),
    ["release-workflow"],
    "keyless is the only authority; there is no key or static pass",
  );
  const identities = authorities[0]!.keyless!.identities;
  assert.deepEqual(
    identities,
    trust.subjects.map((subject) => ({ issuer, subject })),
  );
  for (const identity of identities as Identity[]) {
    assert.equal(identity.subjectRegExp, undefined);
    assert.equal(identity.issuerRegExp, undefined);
    assert.match(
      identity.subject!,
      /^https:\/\/github\.com\/corekraft\/kore\/\.github\/workflows\/release\.yaml@refs\/tags\/v\d+\.\d+\.\d+$/,
    );
  }
});

for (const [form, subject] of Object.entries(unauthorizedSubjects)) {
  test(`managed-example does not admit ${form}`, async () => {
    const repository = await loadRepository("managed-example");
    const identities = (await renderPlatformImages(repository))[0]!.keyless!
      .identities;

    assert.equal(admits(identities, { issuer, subject }), false);
    assert.equal(
      admits(identities, { issuer: "https://accounts.example.com", subject }),
      false,
    );
  });

  test(`validation rejects ${form} as a trust subject`, async () => {
    const base = await loadRepository("managed-example");
    const trust = base.imageTrustValues?.["trust"] as {
      subjects: string[];
    };
    const repository: Repository = {
      ...base,
      imageTrustValues: {
        trust: { ...trust, subjects: [...trust.subjects, subject] },
      },
    };

    await assert.rejects(validateRepository(repository), /subject/i);
  });
}

test("the release subjects themselves are admitted by the matcher the fixture uses", async () => {
  const repository = await loadRepository("managed-example");
  const trust = repository.imageTrustValues?.["trust"] as {
    subjects: string[];
  };
  const identities = (await renderPlatformImages(repository))[0]!.keyless!
    .identities;

  assert.equal(
    admits(identities, { issuer, subject: trust.subjects[0]! }),
    true,
    "a matcher that admits nothing would make the denial tests vacuous",
  );
});

test("local admits only the cosign-system/kore-local-signing-pub key", async () => {
  const repository = await loadRepository("local");
  const authorities = await renderPlatformImages(repository);

  assert.deepEqual(authorities, [
    {
      name: "local-signing-key",
      key: {
        secretRef: {
          name: "kore-local-signing-pub",
          namespace: "cosign-system",
        },
      },
    },
  ]);
});

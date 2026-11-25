import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  documents,
  golden,
  imagePolicyOn,
  issuer,
  keyTrust,
  keylessTrust,
  named,
  policyNames,
  records,
  render,
  subjects,
} from "./image-policy-render-support.js";

// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md (image admission),
// docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md (admission binds an image to its record).
// Issue 1556: behind suborg-image-policy, each app record with a release gets its own
// ClusterImagePolicy over its release digests, in enforce, with one keyless authority
// (the platform workflow identity of trust) and a Rego policy that binds the signing
// workflow's repository to the record's repository. Platform images keep their policy.

const run = promisify(execFile);

const checkoutDigest = `sha256:${"a".repeat(64)}`;
const checkoutBffDigest = `sha256:${"b".repeat(64)}`;
const paymentsDigest = `sha256:${"c".repeat(64)}`;

const checkout = {
  service: "checkout",
  repository: "github.com/example-org/checkout",
  digests: [checkoutDigest, checkoutBffDigest],
};
const payments = {
  service: "payments",
  repository: "github.com/example-org/payments",
  digests: [paymentsDigest],
};

const on = (...images: unknown[]) => [...imagePolicyOn, ...records(images)];

/** The Rego module of a rendered policy: the block under `data: |`, unindented. */
function regoOf(policy: string): string {
  const lines = policy.split("\n");
  const start = lines.findIndex((line) => /^ +data: \|-?$/.test(line));
  assert.notEqual(start, -1, "the policy carries an inline Rego module");
  const indent = lines[start]!.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) {
      break;
    }
    body.push(line);
  }
  const bodyIndent = body.find((line) => line.trim() !== "")!.search(/\S/);
  return body.map((line) => line.slice(bodyIndent)).join("\n");
}

/**
 * Evaluates a rendered module as Policy Controller v0.13.1 does: Rego v0 parsing,
 * data.sigstore.isCompliant over the PolicyResult JSON of one image.
 */
async function compliant(module: string, input: unknown): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), "kore-image-policy-rego-"));
  try {
    await writeFile(join(directory, "sigstore.rego"), module);
    await writeFile(join(directory, "input.json"), JSON.stringify(input));
    const { stdout } = await run("opa", [
      "eval",
      "--v0-compatible",
      "--format",
      "json",
      "--data",
      join(directory, "sigstore.rego"),
      "--input",
      join(directory, "input.json"),
      "data.sigstore.isCompliant",
    ]);
    const result = JSON.parse(stdout) as {
      result: { expressions: { value: unknown }[] }[];
    };
    return result.result[0]?.expressions[0]?.value === true;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const signedBy = (subject: string, signer: string, repo: string) => ({
  authorityMatches: {
    "platform-workflow": {
      signatures: [
        { id: "sig", subject, issuer: signer, githubWorkflowRepo: repo },
      ],
    },
  },
});

test("with suborg-tenancy on and suborg-image-policy off the image-policy render equals main's checked-in golden", async () => {
  assert.equal(render(keylessTrust), await readFile(golden, "utf8"));
});

test("with suborg-image-policy off, records passed to the chart render nothing, and an explicit false renders exactly as an absent flag", async () => {
  const main = await readFile(golden, "utf8");
  assert.equal(
    render(
      keylessTrust,
      "--set",
      "features.suborg-image-policy=false",
      ...records([checkout]),
    ),
    main,
  );
  assert.equal(render(keylessTrust, ...records([checkout])), main);
});

test("with suborg-image-policy on and no record, no application policy renders and the render equals main's", async () => {
  assert.equal(
    render(keylessTrust, ...imagePolicyOn),
    await readFile(golden, "utf8"),
  );
});

test("with suborg-image-policy on, each record gets its own policy and the platform, template and upstream policies are unchanged", async () => {
  const rendered = render(keylessTrust, ...on(checkout, payments));
  assert.deepEqual(policyNames(rendered), [
    "kore-app-checkout",
    "kore-app-payments",
    "kore-platform-images",
    "kore-template-images",
    "kore-upstream-images",
  ]);
  const main = await readFile(golden, "utf8");
  for (const name of [
    "kore-platform-images",
    "kore-template-images",
    "kore-upstream-images",
  ]) {
    assert.equal(named(rendered, name), named(main, name), name);
  }
  assert.match(named(rendered, "kore-platform-images")!, /^  mode: warn$/m);
});

test("a record's policy is in enforce, covers exactly the record's release digests, and has exactly one keyless authority: the platform workflow identity of trust", () => {
  const policy = named(
    render(keylessTrust, ...on(checkout, payments)),
    "kore-app-checkout",
  )!;
  assert.match(policy, /^kind: ClusterImagePolicy$/m);
  assert.match(policy, /^  mode: enforce$/m);
  assert.deepEqual(
    [...policy.matchAll(/^    - glob: (.+)$/gm)].map((match) => match[1]),
    [`"**@${checkoutDigest}"`, `"**@${checkoutBffDigest}"`],
  );
  assert.deepEqual(
    [...policy.matchAll(/^    - name: (.+)$/gm)].map((match) => match[1]),
    ["platform-workflow"],
    "exactly one authority",
  );
  assert.match(policy, /^      keyless:$/m);
  assert.deepEqual(
    [
      ...policy.matchAll(
        /^          - issuer: "(.+)"\n            subject: "(.+)"$/gm,
      ),
    ].map((match) => [match[1], match[2]]),
    subjects.map((subject) => [issuer, subject]),
  );
  assert.doesNotMatch(
    policy,
    /static:|key:|secretRef:|subjectRegExp|issuerRegExp/,
  );
  assert.match(
    policy,
    /^      source:\n        - signaturePullSecrets:\n            - name: "kore-registry-read"$/m,
  );
});

test("the rendered rules admit an image the platform workflow signed from the record's own repository", async () => {
  const module = regoOf(
    named(render(keylessTrust, ...on(checkout)), "kore-app-checkout")!,
  );
  assert.equal(
    await compliant(
      module,
      signedBy(subjects[0]!, issuer, "example-org/checkout"),
    ),
    true,
  );
});

test("the rendered rules refuse an image signed by any other identity, even from the record's repository", async () => {
  const module = regoOf(
    named(render(keylessTrust, ...on(checkout)), "kore-app-checkout")!,
  );
  for (const [subject, signer] of [
    [
      "https://github.com/example-org/checkout/.github/workflows/build.yaml@refs/heads/main",
      issuer,
    ],
    [
      "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v9.9.9",
      issuer,
    ],
    [subjects[0]!, "https://accounts.google.com"],
  ] as const) {
    assert.equal(
      await compliant(
        module,
        signedBy(subject, signer, "example-org/checkout"),
      ),
      false,
      `${subject} under ${signer}`,
    );
  }
});

test("the repository binding refuses an image the platform workflow signed for another record's repository", async () => {
  const rendered = render(keylessTrust, ...on(checkout, payments));
  const checkoutRules = regoOf(named(rendered, "kore-app-checkout")!);
  assert.equal(
    await compliant(
      checkoutRules,
      signedBy(subjects[0]!, issuer, "example-org/payments"),
    ),
    false,
  );
  const paymentsRules = regoOf(named(rendered, "kore-app-payments")!);
  assert.equal(
    await compliant(
      paymentsRules,
      signedBy(subjects[0]!, issuer, "example-org/checkout"),
    ),
    false,
  );
});

test("with suborg-image-policy on and a key trust, the chart refuses to render, naming the flag and the fix", () => {
  assert.throws(
    () => render(keyTrust, ...on(checkout)),
    (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr);
      assert.match(
        stderr,
        /suborg-image-policy needs a keyless trust \(the platform workflow identity\); set trust\.type keyless in the kore-image-policy values overlay, or turn suborg-image-policy off/,
      );
      return true;
    },
  );
});

test("with suborg-image-policy off, a key trust renders as it does on main, with no application policy", () => {
  const rendered = render(keyTrust, ...records([checkout]));
  assert.deepEqual(policyNames(rendered), [
    "kore-platform-images",
    "kore-template-images",
    "kore-upstream-images",
  ]);
  assert.equal(documents(rendered).length, 3);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import {
  auditEvidence,
  evaluateAudit,
  policyPromotionErrors,
  type PromotionRecord,
} from "./policy-promotion.js";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
const now = new Date("2026-11-08T12:00:00Z");
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

const constraint = (name: string, action: string): string =>
  `apiVersion: constraints.gatekeeper.sh/v1beta1
kind: KoreRbac
metadata: {name: ${name}}
spec:
  enforcementAction: ${action}
`;

const record = (over: Partial<PromotionRecord> = {}): PromotionRecord => ({
  constraint: "kore-rbac",
  from: "dryrun",
  to: "deny",
  environments: {
    local: { observedAt: "2026-11-07T10:00:00Z", totalViolations: 0 },
  },
  ...over,
});

async function sandbox(
  constraints: Record<string, string>,
  records: Record<string, unknown> = {},
): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-promotion-"));
  temporary.push(root);
  const policies = join(root, "infra/policies/gatekeeper");
  await mkdir(join(policies, "constraints"), { recursive: true });
  await mkdir(join(policies, "promotions"), { recursive: true });
  for (const [file, text] of Object.entries(constraints)) {
    await writeFile(join(policies, "constraints", file), text);
  }
  for (const [file, value] of Object.entries(records)) {
    await writeFile(join(policies, "promotions", file), JSON.stringify(value));
  }
  return { ...(await loadRepository("local")), root };
}

test("every committed constraint starts in dryrun, so none needs evidence yet", async () => {
  const repository = await loadRepository("local");
  assert.deepEqual(await policyPromotionErrors(repository, now), []);
  await validateRepository(repository);
});

test("a constraint that enforces without a promotion record is rejected with the fix", async () => {
  const repository = await sandbox({
    "rbac.yaml": constraint("kore-rbac", "deny"),
  });
  const errors = await policyPromotionErrors(repository, now);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /kore-rbac.*deny.*promotions\/kore-rbac\.json/);
});

test("promotion is per constraint: one with evidence enforces while the others stay in dryrun", async () => {
  const repository = await sandbox(
    {
      "rbac.yaml": constraint("kore-rbac", "deny"),
      "secrets.yaml": constraint("kore-secrets", "dryrun"),
    },
    { "kore-rbac.json": record() },
  );
  assert.deepEqual(await policyPromotionErrors(repository, now), []);
});

test("a promotion with audit violations is rejected", async () => {
  const repository = await sandbox(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    {
      "kore-rbac.json": record({
        environments: {
          local: { observedAt: "2026-11-07T10:00:00Z", totalViolations: 3 },
        },
      }),
    },
  );
  assert.match(
    (await policyPromotionErrors(repository, now)).join("\n"),
    /kore-rbac.*3 audit violations.*local/s,
  );
});

test("a promotion without evidence for this environment is rejected", async () => {
  const repository = await sandbox(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    { "kore-rbac.json": record({ environments: {} }) },
  );
  assert.match(
    (await policyPromotionErrors(repository, now)).join("\n"),
    /no audit evidence for environment local/,
  );
});

test("stale evidence is rejected so a promotion reflects the current platform", async () => {
  const repository = await sandbox(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    {
      "kore-rbac.json": record({
        environments: {
          local: { observedAt: "2026-10-01T00:00:00Z", totalViolations: 0 },
        },
      }),
    },
  );
  assert.match(
    (await policyPromotionErrors(repository, now)).join("\n"),
    /older than 14 days/,
  );
});

test("a record that names another constraint or another action is rejected", async () => {
  const repository = await sandbox(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    { "kore-rbac.json": record({ constraint: "kore-secrets", to: "warn" }) },
  );
  const text = (await policyPromotionErrors(repository, now)).join("\n");
  assert.match(text, /names constraint kore-secrets/);
  assert.match(text, /promotes to warn but the constraint enforces deny/);
});

test("an unknown enforcementAction is rejected", async () => {
  const repository = await sandbox({
    "rbac.yaml": constraint("kore-rbac", "enforce"),
  });
  assert.match(
    (await policyPromotionErrors(repository, now)).join("\n"),
    /enforcementAction enforce must be dryrun, warn, or deny/,
  );
});

test("a malformed promotion record is rejected rather than ignored", async () => {
  const repository = await sandbox(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    { "kore-rbac.json": { constraint: "kore-rbac" } },
  );
  assert.match(
    (await policyPromotionErrors(repository, now)).join("\n"),
    /kore-rbac\.json is not a valid promotion record/,
  );
});

test("audit evidence is read from the constraint status without extra fields", () => {
  assert.deepEqual(
    auditEvidence({
      metadata: { name: "kore-rbac" },
      spec: { enforcementAction: "dryrun" },
      status: {
        auditTimestamp: "2026-11-08T11:00:00Z",
        totalViolations: 0,
        violations: [{ message: "contains a name" }],
      },
    }),
    { observedAt: "2026-11-08T11:00:00Z", totalViolations: 0 },
  );
});

test("a constraint that has not been audited yet yields no evidence", () => {
  assert.equal(auditEvidence({ status: {} }), undefined);
  assert.equal(
    auditEvidence({ status: { auditTimestamp: "2026-11-08T11:00:00Z" } }),
    undefined,
  );
});

test("an unparsable promotion record is rejected rather than crashing validation", async () => {
  const repository = await sandbox({
    "rbac.yaml": constraint("kore-rbac", "deny"),
  });
  await writeFile(
    join(
      repository.root,
      "infra/policies/gatekeeper/promotions/kore-rbac.json",
    ),
    "{ not json",
  );
  assert.match(
    (await policyPromotionErrors(repository, now)).join("\n"),
    /kore-rbac\.json is not a valid promotion record/,
  );
});

test("an enforcing constraint with audit violations fails its evaluation", () => {
  const report = evaluateAudit({
    metadata: { name: "kore-rbac" },
    spec: { enforcementAction: "deny" },
    status: { auditTimestamp: "2026-11-08T10:00:00Z", totalViolations: 2 },
  });
  assert.equal(report.failure?.includes("kore-rbac"), true);
  assert.equal(report.failure?.includes("2 violations"), true);
});

test("a warn constraint with no violations passes its evaluation", () => {
  const report = evaluateAudit({
    metadata: { name: "kore-rbac" },
    spec: { enforcementAction: "warn" },
    status: { auditTimestamp: "2026-11-08T10:00:00Z", totalViolations: 0 },
  });
  assert.equal(report.failure, undefined);
});

test("a dryrun constraint with violations records evidence and the first resources without failing", () => {
  const violations = Array.from({ length: 8 }, (_, i) => ({
    kind: "ClusterRole",
    name: `role-${i}`,
    message: "secret text must not be recorded",
    enforcementAction: "dryrun",
  }));
  const report = evaluateAudit({
    metadata: { name: "kore-rbac" },
    spec: { enforcementAction: "dryrun" },
    status: {
      auditTimestamp: "2026-11-08T10:00:00Z",
      totalViolations: 8,
      violations,
    },
  });
  assert.equal(report.failure, undefined);
  assert.equal(report.evidence?.totalViolations, 8);
  assert.deepEqual(report.sample, [
    "ClusterRole/role-0",
    "ClusterRole/role-1",
    "ClusterRole/role-2",
    "ClusterRole/role-3",
    "ClusterRole/role-4",
  ]);
  assert.equal(JSON.stringify(report).includes("secret text"), false);
});

test("namespaced violating resources are named kind, namespace, and name", () => {
  const report = evaluateAudit({
    metadata: { name: "c" },
    spec: { enforcementAction: "dryrun" },
    status: {
      auditTimestamp: "2026-11-08T10:00:00Z",
      totalViolations: 1,
      violations: [{ kind: "Role", namespace: "ns", name: "r" }],
    },
  });
  assert.deepEqual(report.sample, ["Role/ns/r"]);
});

test("a constraint that has not been audited yet fails its evaluation", () => {
  const report = evaluateAudit({
    metadata: { name: "c" },
    spec: { enforcementAction: "deny" },
  });
  assert.equal(report.failure?.includes("not been audited"), true);
});

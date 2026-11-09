import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { loadRepository } from "./config.js";
import {
  promoteConstraint,
  recordPromotionEvidence,
  rollbackConstraint,
} from "./policy-promotion-change.js";
import { policyPromotionErrors } from "./policy-promotion.js";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0072-constraint-promotion-procedure.md
const now = new Date("2026-11-09T12:00:00Z");
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

const constraintText = (name: string, action: string): string =>
  `apiVersion: constraints.gatekeeper.sh/v1beta1
kind: KoreRbac
metadata: {name: ${name}}
spec:
  enforcementAction: ${action}
  match: {kinds: [{apiGroups: [apps], kinds: [Deployment]}]}
`;

const audit = (violations: number, at = "2026-11-08T10:00:00Z") => ({
  metadata: { name: "kore-rbac" },
  status: {
    auditTimestamp: at,
    totalViolations: violations,
    violations: Array.from({ length: violations }, () => ({
      kind: "Deployment",
      name: "leaky",
      message: "secret-looking message",
    })),
  },
});

async function sandbox(
  constraints: Record<string, string> = {
    "rbac.yaml": constraintText("kore-rbac", "dryrun"),
  },
): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-promote-"));
  temporary.push(root);
  const policies = join(root, "infra/policies/gatekeeper");
  await mkdir(join(policies, "constraints"), { recursive: true });
  for (const [file, text] of Object.entries(constraints)) {
    await writeFile(join(policies, "constraints", file), text);
  }
  return { ...(await loadRepository("local")), root };
}

const file = (repository: Repository, path: string): Promise<string> =>
  readFile(join(repository.root, "infra/policies/gatekeeper", path), "utf8");

test("recording audit evidence keeps only the timestamp and count, never violation messages", async () => {
  const repository = await sandbox();
  await recordPromotionEvidence(repository, "kore-rbac", audit(0));
  const text = await file(repository, "promotions/kore-rbac.json");
  assert.deepEqual(JSON.parse(text), {
    constraint: "kore-rbac",
    from: "dryrun",
    to: "deny",
    environments: {
      local: { observedAt: "2026-11-08T10:00:00Z", totalViolations: 0 },
    },
  });
  assert.doesNotMatch(text, /secret-looking|leaky/);
});

test("recording evidence for one environment keeps the evidence of the others", async () => {
  const repository = await sandbox();
  const dir = join(repository.root, "infra/policies/gatekeeper/promotions");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "kore-rbac.json"),
    JSON.stringify({
      constraint: "kore-rbac",
      from: "dryrun",
      to: "deny",
      environments: {
        other: { observedAt: "2026-11-01T00:00:00Z", totalViolations: 0 },
      },
    }),
  );
  await recordPromotionEvidence(repository, "kore-rbac", audit(0));
  const record = JSON.parse(
    await file(repository, "promotions/kore-rbac.json"),
  );
  assert.deepEqual(Object.keys(record.environments).sort(), ["local", "other"]);
});

test("recording refuses an audit of a different constraint or one never audited", async () => {
  const repository = await sandbox();
  await assert.rejects(
    recordPromotionEvidence(repository, "kore-rbac", {
      ...audit(0),
      metadata: { name: "kore-secrets" },
    }),
    /names kore-secrets, not kore-rbac/,
  );
  await assert.rejects(
    recordPromotionEvidence(repository, "kore-rbac", {
      metadata: { name: "kore-rbac" },
    }),
    /has not been audited yet/,
  );
});

test("promoting a constraint with clean recent evidence sets only that constraint to deny", async () => {
  const repository = await sandbox({
    "rbac.yaml": constraintText("kore-rbac", "dryrun"),
    "secrets.yaml": constraintText("kore-secrets", "dryrun"),
  });
  await recordPromotionEvidence(repository, "kore-rbac", audit(0));
  const result = await promoteConstraint(repository, "kore-rbac", now);
  assert.deepEqual(result, {
    constraint: "kore-rbac",
    from: "dryrun",
    to: "deny",
  });
  assert.match(
    await file(repository, "constraints/rbac.yaml"),
    /enforcementAction: deny\n/,
  );
  assert.match(
    await file(repository, "constraints/secrets.yaml"),
    /enforcementAction: dryrun\n/,
  );
  assert.deepEqual(await policyPromotionErrors(repository, now), []);
});

test("promotion is refused while the recorded evidence shows violations, and nothing changes", async () => {
  const repository = await sandbox();
  const before = await file(repository, "constraints/rbac.yaml");
  await recordPromotionEvidence(repository, "kore-rbac", audit(3));
  await assert.rejects(
    promoteConstraint(repository, "kore-rbac", now),
    /3 audit violations.*fix the platform/,
  );
  assert.equal(await file(repository, "constraints/rbac.yaml"), before);
});

test("promotion is refused on stale evidence and on missing evidence", async () => {
  const repository = await sandbox();
  await assert.rejects(
    promoteConstraint(repository, "kore-rbac", now),
    /no promotion record.*kore policy record/s,
  );
  await recordPromotionEvidence(
    repository,
    "kore-rbac",
    audit(0, "2026-10-01T00:00:00Z"),
  );
  await assert.rejects(
    promoteConstraint(repository, "kore-rbac", now),
    /older than 14 days; audit again/,
  );
  assert.match(await file(repository, "constraints/rbac.yaml"), /dryrun/);
});

test("promotion is refused for evidence of another environment", async () => {
  const repository = await sandbox();
  await recordPromotionEvidence(repository, "kore-rbac", audit(0));
  await assert.rejects(
    promoteConstraint(
      {
        ...repository,
        environment: { ...repository.environment, name: "managed-example" },
      },
      "kore-rbac",
      now,
    ),
    /no audit evidence for environment managed-example/,
  );
});

test("promotion names the constraint it cannot find or that already enforces", async () => {
  const repository = await sandbox({
    "rbac.yaml": constraintText("kore-rbac", "deny"),
  });
  await assert.rejects(
    promoteConstraint(repository, "kore-nope", now),
    /no constraint named kore-nope/,
  );
  await assert.rejects(
    promoteConstraint(repository, "kore-rbac", now),
    /already deny/,
  );
});

test("rollback returns one enforcing constraint to dryrun and keeps its evidence", async () => {
  const repository = await sandbox({
    "rbac.yaml": constraintText("kore-rbac", "dryrun"),
    "secrets.yaml": constraintText("kore-secrets", "deny"),
  });
  await recordPromotionEvidence(repository, "kore-rbac", audit(0));
  await promoteConstraint(repository, "kore-rbac", now);
  const result = await rollbackConstraint(repository, "kore-rbac");
  assert.deepEqual(result, {
    constraint: "kore-rbac",
    from: "deny",
    to: "dryrun",
  });
  assert.match(
    await file(repository, "constraints/rbac.yaml"),
    /enforcementAction: dryrun\n/,
  );
  assert.match(
    await file(repository, "constraints/secrets.yaml"),
    /enforcementAction: deny\n/,
  );
  assert.match(
    await file(repository, "promotions/kore-rbac.json"),
    /"totalViolations": 0/,
  );
  await assert.rejects(
    rollbackConstraint(repository, "kore-rbac"),
    /already dryrun/,
  );
});

test("promote then rollback restores the constraint file byte for byte", async () => {
  const repository = await sandbox();
  const before = await file(repository, "constraints/rbac.yaml");
  await recordPromotionEvidence(repository, "kore-rbac", audit(0));
  await promoteConstraint(repository, "kore-rbac", now);
  await rollbackConstraint(repository, "kore-rbac");
  assert.equal(await file(repository, "constraints/rbac.yaml"), before);
});

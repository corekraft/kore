// Docs: docs/decisions/0072-constraint-promotion-procedure.md
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { fakeRepository } from "./config-support.js";
import {
  auditEvidence,
  isRecord,
  parseJson,
  recordErrors,
} from "./policy-promotion.js";
import {
  promoteConstraint,
  recordPromotionEvidence,
  rollbackConstraint,
} from "./policy-promotion-change.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("./policy-promotion.js");

const CONSTRAINTS = "/repo/infra/policies/gatekeeper/constraints";
const PROMOTIONS = "/repo/infra/policies/gatekeeper/promotions";
const RBAC = `${CONSTRAINTS}/rbac.yaml`;
const RECORD = `${PROMOTIONS}/kore-rbac.json`;
const NOW = new Date("2026-11-08T12:00:00Z");
const FRESH = "2026-11-07T10:00:00Z";
const EVIDENCE = { observedAt: FRESH, totalViolations: 0 };

// readdir is overloaded; the typed view is the one the policy code calls.
const listDir = vi.mocked<(path: string) => Promise<string[]>>(readdir);

/** The files the fake filesystem holds, by absolute path. */
const files = new Map<string, string>();

const constraintText = (action: string) =>
  `apiVersion: constraints.gatekeeper.sh/v1beta1
kind: KoreRbac
metadata: {name: kore-rbac}
spec:
  enforcementAction: ${action}
  match: {}
`;

const repository = () => fakeRepository({ root: "/repo" });

beforeEach(() => {
  files.clear();
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  listDir.mockImplementation(async (dir) =>
    dir === CONSTRAINTS ? ["rbac.yaml"] : [],
  );
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = typeof path === "string" ? files.get(path) : undefined;
    if (text === undefined) {
      throw new Error("ENOENT");
    }
    return text;
  });
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(isRecord).mockReturnValue(true);
  vi.mocked(parseJson).mockReturnValue(undefined);
  vi.mocked(recordErrors).mockReturnValue([]);
});

const record = (fields: Record<string, unknown> = {}) => ({
  constraint: "kore-rbac",
  from: "dryrun",
  to: "deny",
  environments: { prod: EVIDENCE },
  ...fields,
});

/** A record file on disk, parsed as the given value. */
function onDisk(value: unknown): void {
  files.set(RECORD, JSON.stringify(value));
  vi.mocked(parseJson).mockReturnValue(value);
}

const audit = (name = "kore-rbac") => ({ metadata: { name }, status: {} });

test("an audit of a constraint the repository does not have is refused", async () => {
  listDir.mockResolvedValue([]);
  await expect(
    recordPromotionEvidence(repository(), "kore-rbac", audit()),
  ).rejects.toThrow(
    "policy: no constraint named kore-rbac in infra/policies/gatekeeper/constraints; list the files there for the exact metadata name",
  );
});

test("an audit that names another constraint is refused, and nothing is written", async () => {
  files.set(RBAC, constraintText("dryrun"));
  await expect(
    recordPromotionEvidence(repository(), "kore-rbac", audit("kore-other")),
  ).rejects.toThrow(
    "policy: the audit names kore-other, not kore-rbac; pass the output of kubectl get for kore-rbac",
  );
  expect(writeFile).not.toHaveBeenCalled();
});

test("an audit with no evidence yet asks for another cycle before recording", async () => {
  files.set(RBAC, constraintText("dryrun"));
  vi.mocked(auditEvidence).mockReturnValue(undefined);
  await expect(
    recordPromotionEvidence(repository(), "kore-rbac", audit()),
  ).rejects.toThrow(
    "policy: kore-rbac has not been audited yet; wait for an audit cycle and read it again",
  );
});

test("the first evidence creates the record, targeting deny, as formatted JSON", async () => {
  files.set(RBAC, constraintText("dryrun"));
  vi.mocked(auditEvidence).mockReturnValue(EVIDENCE);
  const written = await recordPromotionEvidence(
    repository(),
    "kore-rbac",
    audit(),
  );
  expect(mkdir).toHaveBeenCalledWith(PROMOTIONS, { recursive: true });
  expect(writeFile).toHaveBeenCalledWith(
    RECORD,
    `${JSON.stringify(
      {
        constraint: "kore-rbac",
        from: "dryrun",
        to: "deny",
        environments: { local: EVIDENCE },
      },
      null,
      2,
    )}\n`,
  );
  expect(written.environments).toEqual({ local: EVIDENCE });
});

test("evidence for a new environment keeps the others and the target action already recorded", async () => {
  files.set(RBAC, constraintText("dryrun"));
  onDisk(record({ to: "warn" }));
  vi.mocked(auditEvidence).mockReturnValue(EVIDENCE);
  const written = await recordPromotionEvidence(
    repository(),
    "kore-rbac",
    audit(),
  );
  expect(written).toEqual(
    record({ to: "warn", environments: { prod: EVIDENCE, local: EVIDENCE } }),
  );
});

test("an existing record that is not valid is refused, and the fix is to delete it", async () => {
  files.set(RBAC, constraintText("dryrun"));
  onDisk({ nope: true });
  vi.mocked(isRecord).mockReturnValue(false);
  vi.mocked(auditEvidence).mockReturnValue(EVIDENCE);
  await expect(
    recordPromotionEvidence(repository(), "kore-rbac", audit()),
  ).rejects.toThrow(
    "policy promotion: infra/policies/gatekeeper/promotions/kore-rbac.json is not a valid promotion record; delete it and run kore policy record again",
  );
});

test("a promotion with a clean record moves only this constraint's action, and reports the change", async () => {
  files.set(RBAC, constraintText("dryrun"));
  onDisk(record());
  const change = await promoteConstraint(repository(), "kore-rbac", NOW);
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(
    RBAC,
    constraintText("deny"),
  );
  expect(change).toEqual({
    constraint: "kore-rbac",
    from: "dryrun",
    to: "deny",
  });
});

test("the promotion checks the record against the time it is given, for this environment", async () => {
  files.set(RBAC, constraintText("dryrun"));
  onDisk(record());
  await promoteConstraint(repository(), "kore-rbac", NOW);
  expect(recordErrors).toHaveBeenCalledWith(
    "kore-rbac",
    "deny",
    record(),
    "local",
    NOW,
  );
});

test("a promotion refused by its record names every reason and changes nothing", async () => {
  files.set(RBAC, constraintText("dryrun"));
  onDisk(record());
  vi.mocked(recordErrors).mockReturnValue(["stale evidence", "violations"]);
  await expect(
    promoteConstraint(repository(), "kore-rbac", NOW),
  ).rejects.toThrow("stale evidence\nviolations");
  expect(writeFile).not.toHaveBeenCalled();
});

test("a constraint that already enforces is not promoted again", async () => {
  files.set(RBAC, constraintText("deny"));
  await expect(
    promoteConstraint(repository(), "kore-rbac", NOW),
  ).rejects.toThrow(
    "policy: kore-rbac is already deny; only a dryrun constraint is promoted",
  );
});

test("a dryrun constraint with no promotion record is refused, with the audit to run first", async () => {
  files.set(RBAC, constraintText("dryrun"));
  await expect(
    promoteConstraint(repository(), "kore-rbac", NOW),
  ).rejects.toThrow(
    "policy promotion: kore-rbac has no promotion record; audit it and run kore policy record kore-rbac first",
  );
});

test("rollback returns an enforcing constraint to dryrun, changing only its action", async () => {
  files.set(RBAC, constraintText("deny"));
  const change = await rollbackConstraint(repository(), "kore-rbac");
  expect(writeFile).toHaveBeenCalledExactlyOnceWith(
    RBAC,
    constraintText("dryrun"),
  );
  expect(change).toEqual({
    constraint: "kore-rbac",
    from: "deny",
    to: "dryrun",
  });
});

test("rollback of a constraint already in dryrun is refused, since there is nothing to undo", async () => {
  files.set(RBAC, constraintText("dryrun"));
  await expect(rollbackConstraint(repository(), "kore-rbac")).rejects.toThrow(
    "policy: kore-rbac is already dryrun; nothing to roll back",
  );
  expect(writeFile).not.toHaveBeenCalled();
});

test("rollback of a constraint the repository does not have is refused by name", async () => {
  listDir.mockResolvedValue([]);
  await expect(rollbackConstraint(repository(), "kore-rbac")).rejects.toThrow(
    "policy: no constraint named kore-rbac in infra/policies/gatekeeper/constraints",
  );
});

// Docs: docs/decisions/0059-identity-policy-evidence.md
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { fakeRepository } from "./config-support.js";
import {
  auditEvidence,
  evaluateAudit,
  isRecord,
  parseJson,
  policyPromotionErrors,
  recordErrors,
} from "./policy-promotion.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const NOW = new Date("2026-11-08T12:00:00Z");
const FRESH = "2026-11-07T10:00:00Z";
const CONSTRAINTS = "/repo/infra/policies/gatekeeper/constraints";
const PROMOTIONS = "/repo/infra/policies/gatekeeper/promotions";
// readdir is overloaded; the typed view is the one the policy code calls.
const listDir = vi.mocked<(path: string) => Promise<string[]>>(readdir);

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

const status = (fields: Record<string, unknown>) => ({
  metadata: { name: "kore-rbac" },
  spec: { enforcementAction: "deny" },
  status: fields,
});

const violation = (kind: string, name: string, namespace?: string) => ({
  kind,
  name,
  ...(namespace === undefined ? {} : { namespace }),
  message: "a message that must never be recorded",
});

test("audit evidence is the timestamp and the count, and never the violation messages", () => {
  expect(
    auditEvidence(
      status({
        auditTimestamp: FRESH,
        totalViolations: 2,
        violations: [violation("Deployment", "leaky")],
      }),
    ),
  ).toEqual({ observedAt: FRESH, totalViolations: 2 });
});

test("a constraint with no audit status yet has no evidence, and neither does one missing a field", () => {
  expect(auditEvidence({})).toBeUndefined();
  expect(auditEvidence(status({ auditTimestamp: FRESH }))).toBeUndefined();
});

test("an enforcing constraint with violations fails, naming its count and sample", () => {
  const report = evaluateAudit(
    status({
      auditTimestamp: FRESH,
      totalViolations: 2,
      violations: [
        violation("Deployment", "a", "kore-system"),
        violation("Deployment", "b"),
      ],
    }),
  );
  expect(report.failure).toBe(
    "kore-rbac enforces deny but reports 2 violations (Deployment/kore-system/a, Deployment/b); the platform, including its controllers, must comply",
  );
});

test("a dryrun constraint with violations records its evidence and never fails", () => {
  const report = evaluateAudit({
    metadata: { name: "kore-rbac" },
    spec: { enforcementAction: "dryrun" },
    status: {
      auditTimestamp: FRESH,
      totalViolations: 1,
      violations: [violation("Deployment", "leaky")],
    },
  });
  expect(report).toEqual({
    name: "kore-rbac",
    action: "dryrun",
    evidence: { observedAt: FRESH, totalViolations: 1 },
    sample: ["Deployment/leaky"],
  });
});

test("a clean warn constraint passes its audit", () => {
  const report = evaluateAudit({
    metadata: { name: "kore-rbac" },
    spec: { enforcementAction: "warn" },
    status: { auditTimestamp: FRESH, totalViolations: 0 },
  });
  expect(report).not.toHaveProperty("failure");
});

test("an enforcing constraint that no audit has reached yet fails until a cycle has run", () => {
  const report = evaluateAudit(status({}));
  expect(report.evidence).toBeUndefined();
  expect(report.failure).toBe(
    "kore-rbac has not been audited yet; wait a cycle",
  );
});

test("a constraint with no enforcement action is read as deny", () => {
  expect(
    evaluateAudit({ metadata: { name: "kore-rbac" }, status: {} }).action,
  ).toBe("deny");
});

test("the sample lists at most five violating resources, each without its empty parts", () => {
  const violations = Array.from({ length: 7 }, (_, index) =>
    violation("Pod", `pod-${index}`),
  );
  const report = evaluateAudit(
    status({ auditTimestamp: FRESH, totalViolations: 7, violations }),
  );
  expect(report.sample).toEqual([
    "Pod/pod-0",
    "Pod/pod-1",
    "Pod/pod-2",
    "Pod/pod-3",
    "Pod/pod-4",
  ]);
});

const record = {
  constraint: "kore-rbac",
  from: "dryrun",
  to: "deny",
  environments: { local: { observedAt: FRESH, totalViolations: 0 } },
};

test("a record that names its constraint and promotes from dryrun is a record", () => {
  expect(isRecord(record)).toBe(true);
});

test("a record that does not promote from dryrun, or to an unknown action, is not a record", () => {
  expect(isRecord({ ...record, from: "warn" })).toBe(false);
  expect(isRecord({ ...record, to: "dryrun" })).toBe(false);
});

test("evidence must carry a parseable timestamp and a whole, non-negative count", () => {
  const withEvidence = (evidence: unknown) => ({
    ...record,
    environments: { local: evidence },
  });
  expect(
    isRecord(withEvidence({ observedAt: "not a date", totalViolations: 0 })),
  ).toBe(false);
  expect(
    isRecord(withEvidence({ observedAt: FRESH, totalViolations: -1 })),
  ).toBe(false);
  expect(
    isRecord(withEvidence({ observedAt: FRESH, totalViolations: 1.5 })),
  ).toBe(false);
});

test("JSON text parses, and text that is not JSON is undefined rather than an error", () => {
  expect(parseJson('{"constraint":"kore-rbac"}')).toEqual({
    constraint: "kore-rbac",
  });
  expect(parseJson("{")).toBeUndefined();
});

test("a record that is not a promotion record is reported with the shape it must have", () => {
  expect(
    recordErrors("kore-rbac", "deny", { nope: true }, "local", NOW),
  ).toEqual([
    "policy promotion: infra/policies/gatekeeper/promotions/kore-rbac.json is not a valid promotion record (constraint, from: dryrun, to: warn|deny, environments with observedAt and totalViolations)",
  ]);
});

test("a clean, recent record for this environment has no errors", () => {
  expect(recordErrors("kore-rbac", "deny", record, "local", NOW)).toEqual([]);
});

test("a record for another constraint, or for another target action, is refused", () => {
  expect(recordErrors("kore-other", "warn", record, "local", NOW)).toEqual([
    "policy promotion: kore-other.json names constraint kore-rbac",
    "policy promotion: kore-other promotes to deny but the constraint enforces warn",
  ]);
});

test("a record with no evidence for this environment asks for an audit here", () => {
  expect(recordErrors("kore-rbac", "deny", record, "prod", NOW)).toEqual([
    "policy promotion: kore-rbac has no audit evidence for environment prod; audit it there and record the result",
  ]);
});

test("violations in the recorded evidence refuse enforcement", () => {
  const dirty = {
    ...record,
    environments: { local: { observedAt: FRESH, totalViolations: 3 } },
  };
  expect(recordErrors("kore-rbac", "deny", dirty, "local", NOW)).toEqual([
    "policy promotion: kore-rbac had 3 audit violations in environment local; fix the platform before enforcing",
  ]);
});

test("evidence older than fourteen days must be audited again", () => {
  const stale = {
    ...record,
    environments: {
      local: { observedAt: "2026-10-20T00:00:00Z", totalViolations: 0 },
    },
  };
  expect(recordErrors("kore-rbac", "deny", stale, "local", NOW)).toEqual([
    "policy promotion: kore-rbac evidence for environment local is older than 14 days; audit again",
  ]);
});

// policyPromotionErrors reads the constraint files and the promotion records.

function policies(
  constraints: Record<string, string>,
  promotions: Record<string, string> = {},
): void {
  const texts = new Map<string, string>();
  for (const [file, text] of Object.entries(constraints)) {
    texts.set(`${CONSTRAINTS}/${file}`, text);
  }
  for (const [file, text] of Object.entries(promotions)) {
    texts.set(`${PROMOTIONS}/${file}`, text);
  }
  const listing: Record<string, string[]> = {
    [CONSTRAINTS]: Object.keys(constraints),
    [PROMOTIONS]: Object.keys(promotions),
  };
  listDir.mockImplementation(async (dir) => listing[dir] ?? []);
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = typeof path === "string" ? texts.get(path) : undefined;
    if (text === undefined) {
      throw new Error("ENOENT");
    }
    return text;
  });
}

const constraint = (name: string, action: string) =>
  `apiVersion: constraints.gatekeeper.sh/v1beta1
kind: KoreRbac
metadata: {name: ${name}}
spec:
  enforcementAction: ${action}
`;

const repository = () => fakeRepository({ root: "/repo" });

test("a repository with no constraints directory has nothing to promote, so no errors", async () => {
  listDir.mockRejectedValue(new Error("ENOENT"));
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([]);
});

test("a constraint with no metadata name or enforcement action is refused, naming its file", async () => {
  policies({ "rbac.yaml": "spec: {}\n" });
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    "policy promotion: infra/policies/gatekeeper/constraints/rbac.yaml needs metadata name and spec.enforcementAction",
  ]);
});

test("an enforcement action other than dryrun, warn or deny is refused", async () => {
  policies({ "rbac.yaml": constraint("kore-rbac", "audit") });
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    "policy promotion: kore-rbac enforcementAction audit must be dryrun, warn, or deny",
  ]);
});

test("a dryrun constraint needs no promotion record, so none is read", async () => {
  policies({ "rbac.yaml": constraint("kore-rbac", "dryrun") });
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([]);
  expect(readdir).toHaveBeenCalledTimes(1);
});

test("an enforcing constraint without its promotion record is refused, with the file to write", async () => {
  policies({ "rbac.yaml": constraint("kore-rbac", "deny") });
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    "policy promotion: kore-rbac enforces deny without infra/policies/gatekeeper/promotions/kore-rbac.json; record zero-violation audit evidence for each environment first",
  ]);
});

test("an enforcing constraint is checked against its own promotion record", async () => {
  policies(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    {
      "kore-rbac.json": JSON.stringify({
        ...record,
        environments: {
          local: { observedAt: FRESH, totalViolations: 1 },
        },
      }),
    },
  );
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    "policy promotion: kore-rbac had 1 audit violations in environment local; fix the platform before enforcing",
  ]);
});

test("a promotion record that is not JSON is refused as an invalid record, not a crash", async () => {
  policies(
    { "rbac.yaml": constraint("kore-rbac", "deny") },
    { "kore-rbac.json": "{" },
  );
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    "policy promotion: infra/policies/gatekeeper/promotions/kore-rbac.json is not a valid promotion record (constraint, from: dryrun, to: warn|deny, environments with observedAt and totalViolations)",
  ]);
});

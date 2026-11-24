import { expect, test } from "vitest";
import { buildPlan } from "./migration-plan.js";
import type { MigrationReview } from "./migration-rules.js";

// The plan is a pure function of the review, so no dependency is mocked. Its key order is part of
// the signed payload, so the tests check it as well as the values.
const KEYS = ["release", "migrationsPath", "migrations", "contract", "n1"];

test("the plan for an expand-only release lists each migration as expand, and records the N-1 check as passed", () => {
  const review: MigrationReview = {
    failures: [],
    release: "expand",
    migrations: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
    contract: null,
    needsN1: true,
  };
  const plan = buildPlan(review);
  expect(plan).toEqual({
    release: "expand",
    migrationsPath: "migrations/",
    migrations: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
    contract: null,
    n1: "passed",
  });
  expect(Object.keys(plan)).toEqual(KEYS);
});

test("the plan for a data contract lists its contract migrations, the window it states, and no retired flags", () => {
  const review: MigrationReview = {
    failures: [],
    release: "data-contract",
    migrations: [{ path: "migrations/0005-drop-old.sql", class: "contract" }],
    contract: { lastUsed: "1.2.2+def5678", soakHours: 24, retiredFlags: [] },
    needsN1: true,
  };
  expect(buildPlan(review)).toEqual({
    release: "data-contract",
    migrationsPath: "migrations/",
    migrations: [{ path: "migrations/0005-drop-old.sql", class: "contract" }],
    contract: { lastUsed: "1.2.2+def5678", soakHours: 24, retiredFlags: [] },
    n1: "passed",
  });
});

test("the plan for a code contract carries no migration and names the retired flags, with the N-1 check not applicable", () => {
  const review: MigrationReview = {
    failures: [],
    release: "code-contract",
    migrations: [],
    contract: {
      lastUsed: "1.2.2+def5678",
      soakHours: 6,
      retiredFlags: ["leads.alpha", "leads.zeta"],
    },
    needsN1: false,
  };
  const plan = buildPlan(review);
  expect(plan).toEqual({
    release: "code-contract",
    migrationsPath: "migrations/",
    migrations: [],
    contract: {
      lastUsed: "1.2.2+def5678",
      soakHours: 6,
      retiredFlags: ["leads.alpha", "leads.zeta"],
    },
    n1: "not-applicable",
  });
  expect(Object.keys(plan)).toEqual(KEYS);
});

test("a release with no migration, and a non-carrier, attest the empty plan, which names no path", () => {
  const emptyPlan = {
    release: "none",
    migrationsPath: null,
    migrations: [],
    contract: null,
    n1: "not-applicable",
  };
  expect(
    buildPlan({
      failures: [],
      release: "none",
      migrations: [],
      contract: null,
      needsN1: false,
    }),
  ).toEqual(emptyPlan);
  expect(buildPlan(undefined)).toEqual(emptyPlan);
});

import { beforeEach, expect, test, vi } from "vitest";
import type { AppSource } from "./app-source.js";
import { contractDeclaration } from "./contract-trailers.js";
import { classifyMigrationFile } from "./migration-file.js";
import { buildPlan } from "./migration-plan.js";
import { migrationCarrier, type CarrierInput } from "./migration-carrier.js";
import { migrationReview, type MigrationReview } from "./migration-rules.js";
import { n1Check } from "./n1-check.js";

// The carrier is the unit: each rule it calls is mocked, so these tests observe what it reads from
// the repository, what it hands each rule, and how it joins the failures (ADR 0098).
vi.mock("./contract-trailers.js");
vi.mock("./migration-file.js");
vi.mock("./migration-plan.js");
vi.mock("./migration-rules.js");
vi.mock("./n1-check.js");

const N1 = {
  runner: { run: vi.fn() },
  dir: "/work/leads",
  baseEnv: {},
  apply: "/eval/apply",
  previousSuite: "/eval/suite",
  databaseUrl: "postgres://x",
};

// The carrier reads only the diff and the added files, so only those two reads are scripted.
const source = { changes: vi.fn(), headText: vi.fn() };

const input = (overrides: Partial<CarrierInput> = {}): CarrierInput => ({
  carries: true,
  source: source as unknown as AppSource,
  message: "feat: add a note\n\nSafety-pattern: expand-contract\n",
  version: "1.2.3+abc1234",
  pattern: "expand-contract",
  changedPaths: ["migrations/0002-add-note.sql"],
  newFlags: [],
  retiredFlags: [],
  n1: N1,
  ...overrides,
});

const expandReview: MigrationReview = {
  failures: [],
  release: "expand",
  migrations: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
  contract: null,
  needsN1: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  source.changes.mockResolvedValue([
    { status: "A", path: "migrations/0002-add-note.sql" },
  ]);
  source.headText.mockResolvedValue("create table note (id int)");
  vi.mocked(contractDeclaration).mockReturnValue({ failures: [] });
  vi.mocked(classifyMigrationFile).mockReturnValue({
    path: "migrations/0002-add-note.sql",
    class: "expand",
  });
  vi.mocked(migrationReview).mockReturnValue(expandReview);
  vi.mocked(n1Check).mockResolvedValue([]);
  vi.mocked(buildPlan).mockReturnValue({
    release: "expand",
    migrationsPath: "migrations/",
    migrations: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
    contract: null,
    n1: "passed",
  });
});

test("a non-carrier reads no migration, runs no N-1 check, and attests the empty plan", async () => {
  vi.mocked(buildPlan).mockReturnValue({
    release: "none",
    migrationsPath: null,
    migrations: [],
    contract: null,
    n1: "not-applicable",
  });
  const result = await migrationCarrier(input({ carries: false }));
  expect(result).toEqual({
    failures: [],
    plan: {
      release: "none",
      migrationsPath: null,
      migrations: [],
      contract: null,
      n1: "not-applicable",
    },
  });
  expect(buildPlan).toHaveBeenCalledWith(undefined);
  expect(source.changes).not.toHaveBeenCalled();
  expect(source.headText).not.toHaveBeenCalled();
  expect(contractDeclaration).not.toHaveBeenCalled();
  expect(n1Check).not.toHaveBeenCalled();
});

test("a carrier classifies only the migration files it adds, reading the text of each added .sql file", async () => {
  source.changes.mockResolvedValue([
    { status: "A", path: "migrations/0002-add-note.sql" },
    { status: "M", path: "migrations/0001-init.sql" },
    { status: "A", path: "src/app.ts" },
    { status: "A", path: "migrations/0003-seed.ts" },
  ]);
  await migrationCarrier(input());
  expect(source.headText).toHaveBeenCalledTimes(1);
  expect(source.headText).toHaveBeenCalledWith("migrations/0002-add-note.sql");
  expect(classifyMigrationFile).toHaveBeenCalledWith(
    "migrations/0002-add-note.sql",
    "create table note (id int)",
  );
  expect(classifyMigrationFile).toHaveBeenCalledWith(
    "migrations/0003-seed.ts",
    "",
  );
  expect(classifyMigrationFile).toHaveBeenCalledTimes(2);
});

test("the declaration, the classified files and the diff reach the rules together", async () => {
  vi.mocked(contractDeclaration).mockReturnValue({
    declaration: { kind: "code", lastUsed: "1.2.2+def5678", soakHours: 6 },
    failures: [],
  });
  await migrationCarrier(
    input({ newFlags: ["leads.new"], retiredFlags: ["leads.old"] }),
  );
  expect(contractDeclaration).toHaveBeenCalledWith({
    message: "feat: add a note\n\nSafety-pattern: expand-contract\n",
    version: "1.2.3+abc1234",
    pattern: "expand-contract",
  });
  expect(migrationReview).toHaveBeenCalledWith({
    declaration: { kind: "code", lastUsed: "1.2.2+def5678", soakHours: 6 },
    changes: [{ status: "A", path: "migrations/0002-add-note.sql" }],
    changedPaths: ["migrations/0002-add-note.sql"],
    added: [{ path: "migrations/0002-add-note.sql", class: "expand" }],
    newFlags: ["leads.new"],
    retiredFlags: ["leads.old"],
  });
});

test("the N-1 check runs when the release needs it, and its failures join the release's", async () => {
  vi.mocked(contractDeclaration).mockReturnValue({
    failures: ["Contract-soak-hours is missing"],
  });
  vi.mocked(n1Check).mockResolvedValue([
    "N-1 check: applying the new migrations failed (exit 1): boom",
  ]);
  const result = await migrationCarrier(input());
  expect(n1Check).toHaveBeenCalledWith(N1);
  expect(result.failures).toEqual([
    "Contract-soak-hours is missing",
    "N-1 check: applying the new migrations failed (exit 1): boom",
  ]);
});

test("a release that does not need the N-1 check, such as a code contract, does not run it", async () => {
  vi.mocked(migrationReview).mockReturnValue({
    failures: [],
    release: "code-contract",
    migrations: [],
    contract: {
      lastUsed: "1.2.2+def5678",
      soakHours: 6,
      retiredFlags: ["leads.old"],
    },
    needsN1: false,
  });
  await migrationCarrier(input());
  expect(n1Check).not.toHaveBeenCalled();
});

test("the review's own failures are reported before the N-1 failures, and the plan is built from the review", async () => {
  vi.mocked(migrationReview).mockReturnValue({
    ...expandReview,
    failures: ["migration migrations/0002-add-note.sql was modified"],
  });
  const result = await migrationCarrier(input());
  expect(result.failures).toEqual([
    "migration migrations/0002-add-note.sql was modified",
  ]);
  expect(buildPlan).toHaveBeenCalledWith(
    expect.objectContaining({ release: "expand" }),
  );
  expect(result.plan).toEqual(vi.mocked(buildPlan).mock.results[0]?.value);
});

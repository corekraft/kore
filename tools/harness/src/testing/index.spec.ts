// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expect, test, vi } from "vitest";
import * as testing from "./index.js";
import { cleanGitEnv } from "./git-env.js";
import { harness } from "./records-support.js";
import { FakeRunner } from "./runner-support.js";

// Each support file is replaced by stubs for the names it exports, so the barrel
// loads no production code: automocking would load the whole guard, hook and idea graph.
const { stubs } = vi.hoisted(() => ({
  stubs: (...names: string[]) =>
    Object.fromEntries(names.map((name) => [name, vi.fn()])),
}));

vi.mock("./adr-support.js", () =>
  stubs("ANCHOR", "PLAN", "MemoryFs", "adrFile", "fixture", "INDEX", "NEW"),
);
vi.mock("./cli-support.js", () => stubs("testHarness"));
vi.mock("./delta-support.js", () => stubs("entry", "fakeDeps", "planText"));
vi.mock("./filesystem-support.js", () => stubs("MemoryFileSystem"));
vi.mock("./flag-support.js", () =>
  stubs("OVERLAY", "activate", "overlay", "provenIdea", "repository"),
);
vi.mock("./flow-support.js", () => stubs("T0", "at", "finishedIdea"));
vi.mock("./git-env.js", () => stubs("cleanGitEnv"));
vi.mock("./guard-support.js", () =>
  stubs(
    "allowed",
    "bash",
    "blocked",
    "decide",
    "edit",
    "read",
    "root",
    "vitestConfig",
    "write",
  ),
);
vi.mock("./guardrail-support.js", () =>
  stubs("committedInventory", "committedInventoryText", "inventoryWith"),
);
vi.mock("./kb-support.js", () =>
  stubs(
    "adrFrontmatter",
    "check",
    "cleanTree",
    "fakeDeps",
    "ideaFields",
    "ideaFile",
    "messages",
    "planFrontmatter",
    "usage",
  ),
);
vi.mock("./ledger-support.js", () => stubs("ledgerEvents"));
vi.mock("./memory-filesystem-support.js", () =>
  stubs("MemoryFileSystem", "hasMatchUnder"),
);
vi.mock("./outcome-support.js", () =>
  stubs(
    "GH_USER",
    "ISSUE",
    "LEDGER",
    "PATH",
    "fakeGh",
    "ghWrites",
    "linked",
    "record",
    "withFlag",
  ),
);
vi.mock("./records-support.js", () =>
  stubs("INDEX", "NEW", "ROOT", "harness", "ideaText", "newArgs", "seeded"),
);
vi.mock("./runner-support.js", () => stubs("FakeRunner"));
vi.mock("./session-close-support.js", () =>
  stubs("INSIDE", "gitCommon", "herdrCalls", "layoutOf", "stateFile"),
);
vi.mock("./ruleset-support.js", () =>
  stubs(
    "CANDIDATE",
    "CHECKS",
    "DECLARED",
    "DELETION",
    "LOCK",
    "REPO",
    "body",
    "checksRule",
    "declared",
    "inventory",
    "liveCandidate",
    "liveMain",
    "mutations",
    "prRule",
    "rulesetRepo",
    "sent",
    "sync",
  ),
);

// One name per export. The barrel renames delta's fakeDeps to fakeDeltaDeps, so
// the name fakeDeps is kb's; the adr and records files' INDEX and NEW are
// renamed ADR_INDEX and ADR_NEW.
const EXPORTS = [
  "ADR_INDEX",
  "ADR_NEW",
  "ANCHOR",
  "CANDIDATE",
  "CHECKS",
  "DECLARED",
  "DELETION",
  "FakeRunner",
  "GH_USER",
  "INDEX",
  "ISSUE",
  "LEDGER",
  "LOCK",
  "ledgerEvents",
  "MemoryFs",
  "MemoryFileSystem",
  "NEW",
  "OVERLAY",
  "PATH",
  "PLAN",
  "REPO",
  "ROOT",
  "RootedMemoryFileSystem",
  "T0",
  "TICK_BODY",
  "TICK_PLAN_FILE",
  "activate",
  "activePlan",
  "adrFile",
  "adrFrontmatter",
  "allowed",
  "at",
  "bash",
  "blocked",
  "body",
  "check",
  "checksRule",
  "cleanGitEnv",
  "cleanTree",
  "committedInventory",
  "committedInventoryText",
  "decide",
  "declared",
  "edit",
  "entry",
  "fakeDeltaDeps",
  "fakeDeps",
  "fakeGh",
  "finishedIdea",
  "fixture",
  "gitCommon",
  "ghWrites",
  "harness",
  "hasMatchUnder",
  "herdrCalls",
  "ideaFields",
  "ideaFile",
  "ideaText",
  "INSIDE",
  "inventory",
  "inventoryWith",
  "linked",
  "liveCandidate",
  "liveMain",
  "messages",
  "mutations",
  "newArgs",
  "overlay",
  "planFrontmatter",
  "planHarness",
  "planText",
  "prRule",
  "provenIdea",
  "read",
  "record",
  "repository",
  "root",
  "rulesetRepo",
  "seeded",
  "layoutOf",
  "sent",
  "stateFile",
  "sync",
  "testHarness",
  "tickPlan",
  "usage",
  "vitestConfig",
  "withFlag",
  "write",
];

test("the testing barrel exposes exactly the fakes and fixtures its support files define", () => {
  expect(Object.keys(testing).sort()).toEqual([...EXPORTS].sort());
});

test("the testing barrel re-exports each support file's own function, not a copy", () => {
  expect(testing.cleanGitEnv).toBe(cleanGitEnv);
  expect(testing.harness).toBe(harness);
  expect(testing.FakeRunner).toBe(FakeRunner);
});

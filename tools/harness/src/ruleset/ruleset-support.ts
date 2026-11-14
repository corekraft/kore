// Fakes shared by the ruleset domain's unit specs: typed objects whose members
// are vi.fn mocks, so each spec states the answer it needs and reads the calls
// it made. A support file is not a unit, so it needs no spec of its own (ADR 0098).
import { vi, type Mock } from "vitest";
import type {
  Clock,
  CliDeps,
  CommandContext,
  FileSystem,
  IdSource,
  Runner,
} from "../runtime/index.js";
import { GitHubRulesets } from "./github.js";
import {
  candidateName,
  parseDeclared,
  planCandidate,
  planMain,
  ruleName,
  stage,
  typesOf,
  type CandidatePlan,
  type MainPlan,
} from "./declared.js";
import { modeOf, readInventory, type Inventory } from "../guardrail/index.js";
import { withLock } from "./lock.js";
import { destination } from "./support.js";
import { declaredFields, weakenings } from "./weaken.js";

export const ROOT = "/repo";
export const REPO = "corekraft/kore";
export const NOW = "2026-03-04T05:06:07.000Z";

export interface FakeRunner {
  run: Mock<Runner["run"]>;
}

/** A runner whose calls the spec answers with mockResolvedValue. */
export function fakeRunner(): FakeRunner {
  return { run: vi.fn<Runner["run"]>() };
}

export interface FakeFileSystem {
  readFile: Mock<FileSystem["readFile"]>;
  writeFile: Mock<FileSystem["writeFile"]>;
  createFile: Mock<FileSystem["createFile"]>;
  appendFile: Mock<FileSystem["appendFile"]>;
  exists: Mock<FileSystem["exists"]>;
  readdir: Mock<FileSystem["readdir"]>;
  remove: Mock<FileSystem["remove"]>;
  readlink: Mock<FileSystem["readlink"]>;
  mtimeMs: Mock<FileSystem["mtimeMs"]>;
  isDirectory: Mock<FileSystem["isDirectory"]>;
  readHead: Mock<FileSystem["readHead"]>;
  readFrom: Mock<FileSystem["readFrom"]>;
  hasGlobMatch: Mock<FileSystem["hasGlobMatch"]>;
}

export function fakeFileSystem(): FakeFileSystem {
  return {
    readFile: vi.fn<FileSystem["readFile"]>(),
    writeFile: vi.fn<FileSystem["writeFile"]>(),
    createFile: vi.fn<FileSystem["createFile"]>(),
    appendFile: vi.fn<FileSystem["appendFile"]>(),
    exists: vi.fn<FileSystem["exists"]>(),
    readdir: vi.fn<FileSystem["readdir"]>(),
    remove: vi.fn<FileSystem["remove"]>(),
    readlink: vi.fn<FileSystem["readlink"]>(),
    mtimeMs: vi.fn<FileSystem["mtimeMs"]>(),
    isDirectory: vi.fn<FileSystem["isDirectory"]>(),
    readHead: vi.fn<FileSystem["readHead"]>(),
    readFrom: vi.fn<FileSystem["readFrom"]>(),
    hasGlobMatch: vi.fn<FileSystem["hasGlobMatch"]>(),
  };
}

/** The collaborators a command touches, each a typed fake; the root is ROOT and the clock reads NOW. */
export interface FakeDeps extends CliDeps {
  runner: FakeRunner;
  fs: FakeFileSystem;
  clock: { now: Mock<Clock["now"]>; sleep: Mock<Clock["sleep"]> };
  root: Mock<CliDeps["root"]>;
  stdin: Mock<CliDeps["stdin"]>;
  stdout: Mock<CliDeps["stdout"]>;
  stderr: Mock<CliDeps["stderr"]>;
}

export function fakeDeps(): FakeDeps {
  const ids: IdSource = { next: vi.fn<IdSource["next"]>(() => "id-1") };
  return {
    runner: fakeRunner(),
    clock: {
      now: vi.fn<Clock["now"]>(() => new Date(NOW)),
      sleep: vi.fn<Clock["sleep"]>(),
    },
    fs: fakeFileSystem(),
    root: vi.fn<CliDeps["root"]>(() => Promise.resolve(ROOT)),
    ids,
    env: {},
    cwd: "/work/tree",
    stdin: vi.fn<CliDeps["stdin"]>(() => Promise.resolve("")),
    stdout: vi.fn<CliDeps["stdout"]>(),
    stderr: vi.fn<CliDeps["stderr"]>(),
  };
}

/** A command context over the given flags; `json` selects the machine-readable output. */
export function fakeContext(
  options: Record<string, string | boolean> = {},
  deps: CliDeps = fakeDeps(),
  json = false,
): CommandContext {
  return { json, options, deps };
}

/** The four GitHubRulesets methods a unit reads or writes, each a typed fake. */
export interface FakeGitHub {
  find: Mock<GitHubRulesets["find"]>;
  save: Mock<GitHubRulesets["save"]>;
  suites: Mock<GitHubRulesets["suites"]>;
  suite: Mock<GitHubRulesets["suite"]>;
}

export function fakeGitHub(): FakeGitHub {
  return {
    find: vi.fn<GitHubRulesets["find"]>(),
    save: vi.fn<GitHubRulesets["save"]>(),
    suites: vi.fn<GitHubRulesets["suites"]>(),
    suite: vi.fn<GitHubRulesets["suite"]>(),
  };
}

/** The fake as the real class type: its private members are never read by a unit under test. */
export const asGitHub = (fake: FakeGitHub): GitHubRulesets =>
  fake as unknown as GitHubRulesets;

/** A candidate plan that changes nothing unless overridden. */
export const candidatePlan = (
  overrides: Partial<CandidatePlan> = {},
): CandidatePlan => ({
  name: "main-candidate",
  action: "none",
  enforcement: "evaluate",
  rules: [],
  body: {},
  ...overrides,
});

/** An inventory that lists the named rules, each as enforce; the one cast is the rest of the file, which the units never read. */
export const inventoryOf = (...rules: string[]) =>
  ({
    guardrails: rules.map((rule) => ({ rule, mode: "enforce" })),
  }) as unknown as Inventory;

/** A main plan with every field empty unless overridden. */
export const mainPlan = (overrides: Partial<MainPlan> = {}): MainPlan => ({
  action: "none",
  enforcement: "active",
  added: [],
  removed: [],
  weakened: [],
  pending: [],
  changed: [],
  body: {},
  ...overrides,
});

/**
 * Arms the collaborators of the sync unit (the spec mocks their modules) so a
 * repository declares main, has no live rulesets, and every plan changes nothing.
 * Specs override the one answer they test.
 */
export function armSync(): { deps: FakeDeps; github: FakeGitHub } {
  const deps = fakeDeps();
  const github = fakeGitHub();
  vi.mocked(parseDeclared).mockReturnValue({ name: "main", rules: [] });
  vi.mocked(readInventory).mockResolvedValue(
    inventoryOf("main-ruleset-deletion"),
  );
  vi.mocked(modeOf).mockReturnValue("enforce");
  vi.mocked(typesOf).mockReturnValue(["deletion"]);
  vi.mocked(ruleName).mockImplementation(
    (target, type) => `${target}-ruleset-${type}`,
  );
  vi.mocked(candidateName).mockReturnValue("main-candidate");
  vi.mocked(destination).mockReturnValue({ repo: REPO, target: "main" });
  vi.mocked(stage).mockReturnValue({ main: [], candidate: [], pending: [] });
  vi.mocked(planMain).mockReturnValue(mainPlan());
  vi.mocked(planCandidate).mockReturnValue(candidatePlan());
  vi.mocked(declaredFields).mockReturnValue({});
  vi.mocked(weakenings).mockReturnValue({ removed: [], weaker: [] });
  vi.mocked(withLock).mockImplementation((_deps, _repo, action) => action());
  vi.mocked(GitHubRulesets).mockImplementation(function () {
    return asGitHub(github);
  });
  github.find.mockResolvedValue(undefined);
  github.save.mockResolvedValue(undefined);
  return { deps, github };
}

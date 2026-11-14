// The testing domain: fakes and fixtures that specs, fixtures and test support
// helpers share. Production code never imports it (see .oxlintrc.json).
// Names that two helpers both define are exported once, under one name:
// records owns NEW, INDEX and ROOT; adr's are ADR_NEW and ADR_INDEX; the
// rooted in-memory file system is RootedMemoryFileSystem.
export {
  ANCHOR,
  PLAN,
  MemoryFs,
  adrFile,
  fixture,
  INDEX as ADR_INDEX,
  NEW as ADR_NEW,
} from "./adr-support.js";
export { testHarness, type TestHarness } from "./cli-support.js";
export {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  stateFile,
} from "./session-close-support.js";
export { MemoryFileSystem as RootedMemoryFileSystem } from "./filesystem-support.js";
export {
  OVERLAY,
  activate,
  overlay,
  provenIdea,
  repository,
} from "./flag-support.js";
export { T0, at, finishedIdea } from "./flow-support.js";
export { entry, fakeDeps as fakeDeltaDeps, planText } from "./delta-support.js";
export {
  allowed,
  bash,
  blocked,
  decide,
  edit,
  read,
  root,
  vitestConfig,
  write,
  type Result,
} from "./guard-support.js";
export { cleanGitEnv } from "./git-env.js";
export {
  committedInventory,
  committedInventoryText,
  inventoryWith,
} from "./guardrail-support.js";
export {
  adrFrontmatter,
  check,
  cleanTree,
  fakeDeps,
  ideaFields,
  ideaFile,
  messages,
  planFrontmatter,
  usage,
  type Tree,
} from "./kb-support.js";
export {
  MemoryFileSystem,
  hasMatchUnder,
} from "./memory-filesystem-support.js";
export { ledgerEvents } from "./ledger-support.js";
export {
  GH_USER,
  ISSUE,
  LEDGER,
  PATH,
  fakeGh,
  ghWrites,
  linked,
  record,
  withFlag,
  type FakeIssue,
  type Harness,
} from "./outcome-support.js";
export {
  TICK_BODY,
  TICK_PLAN_FILE,
  activePlan,
  planHarness,
  tickPlan,
} from "./plan-support.js";
export {
  INDEX,
  NEW,
  ROOT,
  harness,
  ideaText,
  newArgs,
  seeded,
} from "./records-support.js";
export {
  FakeRunner,
  type FakeResponse,
  type RecordedCall,
} from "./runner-support.js";
export {
  CANDIDATE,
  CHECKS,
  DECLARED,
  DELETION,
  LOCK,
  REPO,
  body,
  checksRule,
  declared,
  inventory,
  liveCandidate,
  liveMain,
  mutations,
  prRule,
  rulesetRepo,
  sent,
  sync,
  type Mode,
  type Modes,
  type Scene,
} from "./ruleset-support.js";

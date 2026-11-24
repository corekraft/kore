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
export { gitCommon, stateFile } from "./session-close-support.js";
export {
  DEFAULT as LEDGER_FILE,
  harness as ledgerHarness,
} from "./ledger-support.js";
export { MemoryFileSystem as RootedMemoryFileSystem } from "./filesystem-support.js";
export {
  MANIFEST,
  OVERLAY,
  activate,
  flagManifest,
  overlay,
  provenIdea,
  repository,
} from "./flag-support.js";
export { T0, at, finishedIdea, mainSplit } from "./flow-support.js";
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
// The release workflow fixture the workflow-permissions specs share.
export { release as releaseWorkflow } from "../hook/workflow-permissions-support.js";
// The retrospective transcript readers, for the integration spec over real directories.
export {
  defaultDirs,
  readTranscripts,
  repoTranscriptDirs,
} from "../hook/retro-transcripts.js";
// The retrospective scan and its marker, for the integration specs over real transcripts.
export {
  lastRetrospective,
  parseTranscript,
  scan,
  summarizeError,
  windowStart,
} from "../hook/retro-scan.js";
// The bypass corpus is data the guard's real-run spec replays; re-exported here so no integration spec deep-imports the hook domain.
export {
  CORPUS,
  ORDINARY,
  type CorpusCase,
  type OrdinaryCase,
} from "../hook/guard-corpus.js";
// The help-request corpus (#973): refused while gated-help-exempt is off, allowed or still refused with it on.
export {
  HELP_ALLOWED,
  HELP_REFUSED_FLAG_OFF,
  HELP_STILL_REFUSED,
} from "../hook/guard-corpus-help.js";
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
export { stubHelp } from "./help-support.js";
// The Terminals contract: the fake's spec and the integration spec over a real hc core both run it.
export {
  terminalContract,
  type ContractSubject,
} from "../terminal/contract-support.js";

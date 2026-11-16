// The `harness hook retro-scan` command as a unit: which scan it runs with
// which window, rules and skills, and the report or the message it prints. The
// hook wrapper, the guardrail, the plans, the transcript readers and the scan
// are mocked; the real command line over real files is in
// integration/hook/retro-hook.spec.ts.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandError,
  type CliDeps,
  type FileSystem,
} from "../runtime/index.js";
import {
  auditRuleNames,
  GuardrailError,
  readInventory,
} from "../guardrail/index.js";
import { readPlans } from "../plan/index.js";
import { hookCommand } from "./io.js";
import {
  lastRetrospective,
  markerInstant,
  MarkerError,
  scan,
} from "./retro-scan.js";
import { agentSection, skillNames } from "./retro-agents.js";
import { defaultDirs, readTranscripts } from "./retro-transcripts.js";
import "./retro-hook.js";

vi.mock("./io.js", () => ({ hookCommand: vi.fn() }));
vi.mock("../plan/index.js", () => ({ readPlans: vi.fn() }));
vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  auditRuleNames: vi.fn(),
  readInventory: vi.fn(),
}));
vi.mock("./retro-transcripts.js", () => ({
  defaultDirs: vi.fn(),
  readTranscripts: vi.fn(),
}));
vi.mock("./retro-agents.js", () => ({
  agentSection: vi.fn(),
  skillNames: vi.fn(),
}));
vi.mock("./retro-scan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retro-scan.js")>()),
  lastRetrospective: vi.fn(),
  markerInstant: vi.fn(),
  scan: vi.fn(),
}));

type Handler = Parameters<typeof hookCommand>[2];

/** The handler the wrapper registered when the module loaded, read before any reset. */
const registration = vi.mocked(hookCommand).mock.calls[0];

function registeredHandler(): Handler {
  if (registration === undefined) {
    throw new Error("the retro-scan hook was never registered");
  }
  return registration[2];
}
const handler = registeredHandler();

const USAGE =
  "Usage: harness hook retro-scan [--dir <transcripts>] [--since YYYY-MM-DD|YYYY-MM-DDTHH:MM:SSZ] [--evidence]\n--since keeps sessions active at or after local midnight of that date, or at or after that UTC instant, like the session-start count.\n--evidence adds guardEvidence (the session, transcript line and excerpt of each guard block) and overriddenEvidence (the same, with the command excerpt and the unquoted glob the guard named, for each overridden audit warning), capped per rule. The default report leaves them out. The report also lists the agents with no launch in the ledger or in-process Agent call (agents; pane launches under launched, in-process Agent calls counted per agent under inProcess) and a ready command for each finding (proposals): an idea for an unused skill or agent, needing 14 days of ledger or 100 sessions (retro in .claude/harness.json sets each), and a guardrail request for a promotable audit rule. The scan runs none of them.";
const NO_SKILLS = "No skills/ directory found; skills.unused will be empty.\n";

/** A scan report as the scan returns it, with nothing in it. */
const SCANNED: ReturnType<typeof scan> = {
  sessions: { count: 0, first: null, last: null, list: [] },
  skippedLines: 0,
  guards: {},
  failures: [],
  skills: { perSession: {}, unused: [] },
  subagents: {},
  corrections: [],
  rules: { promotable: [], audit: [] },
};

const EXTRA = {
  agents: {
    known: ["refiner"],
    launched: [],
    inProcess: {},
    unused: ["refiner"],
  },
  proposals: {
    history: {
      minDays: 14,
      minSessions: 100,
      days: 3,
      sessions: 0,
      sufficient: false,
    },
    items: [],
  },
};

const notFound = () =>
  Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

/** A typed file system whose four reads the command makes are mocks; with no skills/ directory by default. */
function fakeFs() {
  return {
    readdir: vi.fn<FileSystem["readdir"]>(() => notFound()),
    isDirectory: vi.fn<FileSystem["isDirectory"]>(() => Promise.resolve(false)),
    exists: vi.fn<FileSystem["exists"]>(() => Promise.resolve(false)),
    readFile: vi.fn<FileSystem["readFile"]>((path) =>
      path.endsWith("harness.json") ? notFound() : Promise.resolve(""),
    ),
  };
}

/** The fake as the file system the command reads through; the four reads are mocks, so the one assertion stands for the rest. */
function port(fake: ReturnType<typeof fakeFs>): FileSystem {
  const used: Pick<
    FileSystem,
    "readdir" | "isDirectory" | "exists" | "readFile"
  > = fake;
  return used as FileSystem;
}

/** The host's deps as the command reads them: the root, the file system and HOME. The one cast stands for the rest. */
function depsOf(fs: FileSystem): CliDeps {
  const used: Pick<CliDeps, "root" | "fs" | "env"> = {
    root: () => Promise.resolve("/repo"),
    fs,
    env: { HOME: "/home" },
  };
  return used as CliDeps;
}

/** Runs the command as the host does: the flags it was given, and no stdin. */
function run(options: Record<string, string | boolean> = {}, fs = fakeFs()) {
  return handler({
    deps: depsOf(port(fs)),
    payload: undefined,
    options,
    operand: undefined,
  });
}

beforeEach(() => {
  vi.mocked(markerInstant).mockReturnValue(0);
  vi.mocked(defaultDirs).mockResolvedValue(["/t"]);
  vi.mocked(readTranscripts).mockResolvedValue([{ id: "s", text: "" }]);
  vi.mocked(readPlans).mockResolvedValue({});
  vi.mocked(lastRetrospective).mockReturnValue("2026-11-12");
  vi.mocked(auditRuleNames).mockReturnValue(["bare-glob"]);
  vi.mocked(scan).mockReturnValue(SCANNED);
  vi.mocked(skillNames).mockResolvedValue(undefined);
  vi.mocked(agentSection).mockResolvedValue(EXTRA);
});

describe("retro-scan command: registration and input", () => {
  it("is registered under the name the host runs it by", () => {
    expect(registration?.[0]).toBe("retro-scan");
  });

  it("refuses a --since that is neither a date nor an instant, with the usage", async () => {
    vi.mocked(markerInstant).mockReturnValue(Number.NaN);
    expect(await run({ since: "yesterday" })).toEqual({
      code: 2,
      stderr: `${USAGE}\n`,
    });
    expect(vi.mocked(scan)).not.toHaveBeenCalled();
  });
});

describe("retro-scan command: transcripts", () => {
  it("reports that no transcripts were found for the repository, with the usage", async () => {
    vi.mocked(readTranscripts).mockResolvedValue([]);
    expect(await run()).toEqual({
      code: 2,
      stderr: `No transcripts found for this repository or its worktrees. Pass --dir <transcripts>.\n${USAGE}\n`,
    });
  });

  it("names the directories it could not read", async () => {
    vi.mocked(readTranscripts).mockRejectedValue(new Error("EACCES"));
    expect(await run({ dir: "/t" })).toEqual({
      code: 2,
      stderr: `Cannot read transcripts in /t. Pass --dir <transcripts>.\n${USAGE}\n`,
    });
  });

  it("reads the given --dir, and looks for neither the repository's sessions nor its plans", async () => {
    const fs = fakeFs();
    await run({ dir: "/t" }, fs);
    expect(vi.mocked(readTranscripts)).toHaveBeenCalledWith(port(fs), ["/t"]);
    expect(vi.mocked(defaultDirs)).not.toHaveBeenCalled();
    expect(vi.mocked(readPlans)).not.toHaveBeenCalled();
  });
});

describe("retro-scan command: the window", () => {
  it("takes the window from the latest Last retrospective: marker, and prints the report", async () => {
    const result = await run();
    expect(vi.mocked(scan)).toHaveBeenCalledWith([{ id: "s", text: "" }], {
      since: "2026-11-12",
      knownSkills: [],
      auditRules: ["bare-glob"],
      evidence: false,
    });
    expect(result).toEqual({
      stdout: `${JSON.stringify({ since: "2026-11-12", ...SCANNED, ...EXTRA }, null, 2)}\n`,
      stderr: NO_SKILLS,
    });
  });

  it("scans every session, with a note, when no marker exists", async () => {
    vi.mocked(lastRetrospective).mockReturnValue(null);
    const result = await run();
    expect(vi.mocked(scan).mock.calls[0]?.[1]?.since).toBeUndefined();
    expect(result.stderr).toBe(
      `${NO_SKILLS}No \`Last retrospective:\` date found; scanning all sessions. Pass --since to narrow.\n`,
    );
  });

  it("uses the --since date over any marker in the plans", async () => {
    await run({ since: "2026-11-01" });
    expect(vi.mocked(lastRetrospective)).not.toHaveBeenCalled();
    expect(vi.mocked(scan).mock.calls[0]?.[1]?.since).toBe("2026-11-01");
  });

  it("fails the scan by name for a malformed marker, instead of failing open", async () => {
    vi.mocked(lastRetrospective).mockImplementation(() => {
      throw new MarkerError("infra/plans/3.md:2: bad");
    });
    expect(await run()).toEqual({
      code: 2,
      stderr: "infra/plans/3.md:2: bad\n",
    });
  });

  it("rethrows a plan read fault it does not expect", async () => {
    vi.mocked(readPlans).mockRejectedValue(new Error("boom"));
    await expect(run()).rejects.toThrow(new Error("boom"));
  });
});

describe("retro-scan command: skills, audit rules and evidence", () => {
  it("passes the skills that hold a SKILL.md, and the audit-mode rules", async () => {
    vi.mocked(skillNames).mockResolvedValue(["tdd"]);
    const result = await run({ dir: "/t" });
    expect(vi.mocked(scan).mock.calls[0]?.[1]).toEqual({
      since: undefined,
      knownSkills: ["tdd"],
      auditRules: ["bare-glob"],
      evidence: false,
    });
    expect(result.stderr).toBe("");
  });

  it("adds the agents and proposals sections for the scan's findings and window", async () => {
    await run();
    expect(vi.mocked(agentSection).mock.calls[0]?.[1]).toBe("/repo");
    expect(vi.mocked(agentSection).mock.calls[0]?.[2]).toBe("2026-11-12");
    expect(vi.mocked(agentSection).mock.calls[0]?.[3]).toBe(SCANNED);
  });

  it("passes the evidence flag through to the scan", async () => {
    await run({ dir: "/t", evidence: true });
    expect(vi.mocked(scan).mock.calls[0]?.[1]?.evidence).toBe(true);
  });

  it("turns a guardrail inventory error into a command error with its fix", async () => {
    vi.mocked(readInventory).mockRejectedValue(
      new GuardrailError("fix the inventory"),
    );
    await expect(run({ dir: "/t" })).rejects.toThrow(
      new CommandError("fix the inventory"),
    );
  });

  it("rethrows an inventory fault that is not a guardrail error", async () => {
    vi.mocked(readInventory).mockRejectedValue(new Error("boom"));
    await expect(run({ dir: "/t" })).rejects.toThrow(new Error("boom"));
  });
});

describe("retro-scan command: reads through the file system", () => {
  it("reads the guardrail inventory through the host's file system", async () => {
    const fs = fakeFs();
    await run({ dir: "/t" }, fs);
    const reader = vi.mocked(readInventory).mock.calls[0]?.[0];
    await reader?.("/repo/.claude/guardrails.json");
    expect(fs.readFile).toHaveBeenCalledWith("/repo/.claude/guardrails.json");
  });
});

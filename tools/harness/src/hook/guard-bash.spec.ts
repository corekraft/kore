// Bash rules for a whole command: the glob and =word checks, every segment, then the verdict weighing. Its dependencies are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bareGlob } from "./guard-bare-glob.js";
import { checkBashSegment } from "./guard-bash-segment.js";
import { evaluateBash } from "./guard-bash.js";
import { unquotedGlob } from "./guard-unquoted-glob.js";
import {
  execGlobQualifier,
  rawWords,
  scriptOf,
  shellText,
  splitSegments,
} from "./guard-shell.js";
import {
  applyMode,
  block,
  warn,
  weigh,
  type Finding,
  type GuardContext,
  type Hit,
  type Verdict,
} from "./guard-verdict.js";

vi.mock("./guard-bash-segment.js", () => ({ checkBashSegment: vi.fn() }));
vi.mock("./guard-bare-glob.js", () => ({ bareGlob: vi.fn() }));
vi.mock("./guard-unquoted-glob.js", () => ({ unquotedGlob: vi.fn() }));
vi.mock("./guard-shell.js", () => ({
  execGlobQualifier: vi.fn(),
  rawWords: vi.fn(),
  scriptOf: vi.fn(),
  shellText: vi.fn(),
  splitSegments: vi.fn(),
}));
vi.mock("./guard-verdict.js", () => ({
  applyMode: vi.fn(),
  block: vi.fn(),
  warn: vi.fn(),
  weigh: vi.fn(),
}));

const hit = (rule: string): Hit => ({ action: "block", rule, message: rule });
const ALLOW: Verdict = { action: "allow" };
const ctx: GuardContext = {
  root: "/repo",
  readFile: () => Promise.reject(new Error("no file in this unit")),
  cwd: "/repo",
  home: "/home/test",
  globMatches: () => Promise.resolve(false),
  modeOf: () => "enforce",
  denyRules: [],
};

beforeEach(() => {
  vi.mocked(shellText).mockImplementation((command) => command);
  vi.mocked(splitSegments).mockReturnValue([]);
  vi.mocked(execGlobQualifier).mockReturnValue(undefined);
  vi.mocked(scriptOf).mockReturnValue(undefined);
  vi.mocked(rawWords).mockReturnValue([]);
  vi.mocked(unquotedGlob).mockReturnValue(null);
  vi.mocked(bareGlob).mockResolvedValue(null);
  vi.mocked(checkBashSegment).mockResolvedValue([]);
  vi.mocked(applyMode).mockImplementation((finding: Finding) => finding);
  vi.mocked(weigh).mockReturnValue(ALLOW);
  vi.mocked(block).mockImplementation((rule) => hit(rule));
  vi.mocked(warn).mockImplementation((rule) => ({
    action: "warn",
    rule,
    message: rule,
  }));
});

describe("evaluateBash weighing", () => {
  it("collects the whole-command glob findings, every segment's findings, then the bare glob, and weighs them in that order", async () => {
    const unquoted = hit("unquoted-glob");
    const segmentFinding = hit("secret-path");
    const bare = hit("bare-glob");
    vi.mocked(unquotedGlob).mockReturnValue(unquoted);
    vi.mocked(splitSegments).mockReturnValue([["ls"]]);
    vi.mocked(checkBashSegment).mockResolvedValue([segmentFinding]);
    vi.mocked(bareGlob).mockResolvedValue(bare);
    await evaluateBash("ls", ctx);
    expect(checkBashSegment).toHaveBeenCalledWith(["ls"], ctx);
    expect(bareGlob).toHaveBeenCalledWith("ls", ctx);
    // The qualifier and =word checks are null here; weigh takes every slot, nulls included.
    expect(vi.mocked(weigh).mock.calls[0]?.[0]).toEqual([
      unquoted,
      null,
      segmentFinding,
      bare,
      null,
    ]);
  });

  it("applies each finding's mode before weighing it", async () => {
    vi.mocked(unquotedGlob).mockReturnValue(hit("unquoted-glob"));
    await evaluateBash("ls", ctx);
    expect(applyMode).toHaveBeenCalledWith(hit("unquoted-glob"), ctx);
  });

  it("returns the verdict that weigh decides, unchanged", async () => {
    const verdict: Verdict = {
      action: "warn",
      rule: "image-digest",
      message: "w",
      rules: ["image-digest"],
    };
    vi.mocked(weigh).mockReturnValue(verdict);
    expect(await evaluateBash("ls", ctx)).toBe(verdict);
  });
});

describe("the zsh rules under a verified bash", () => {
  const bash: GuardContext = { ...ctx, verifiedBash: true };

  it("does not run the unquoted-glob, bare-glob or equals-word checks", async () => {
    vi.mocked(unquotedGlob).mockReturnValue(hit("unquoted-glob"));
    vi.mocked(bareGlob).mockResolvedValue(hit("bare-glob"));
    vi.mocked(rawWords).mockReturnValue([
      { text: "=ls", glob: false, equals: true },
    ]);
    await evaluateBash("ls =ls", bash);
    expect(unquotedGlob).not.toHaveBeenCalled();
    expect(bareGlob).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(vi.mocked(weigh).mock.calls[0]?.[0]).toEqual([null, null]);
  });

  it("still checks every segment and the glob qualifier that runs code", async () => {
    const segmentFinding = hit("secret-path");
    vi.mocked(splitSegments).mockReturnValue([["cat", "x"]]);
    vi.mocked(checkBashSegment).mockResolvedValue([segmentFinding]);
    vi.mocked(execGlobQualifier).mockReturnValue("*(e:'id':)");
    await evaluateBash("cat x *(e:'id':)", bash);
    expect(block).toHaveBeenCalledWith(
      "unquoted-glob",
      expect.stringContaining("is a zsh glob qualifier that runs code"),
    );
    expect(checkBashSegment).toHaveBeenCalledWith(["cat", "x"], bash);
    expect(vi.mocked(weigh).mock.calls[0]?.[0]).toEqual([
      null,
      hit("unquoted-glob"),
      segmentFinding,
    ]);
  });

  it.each([
    ["a context that says nothing", ctx],
    [
      "a context that says the shell is not bash",
      { ...ctx, verifiedBash: false },
    ],
  ])("keeps every zsh check for %s", async (_label, context) => {
    vi.mocked(unquotedGlob).mockReturnValue(hit("unquoted-glob"));
    vi.mocked(bareGlob).mockResolvedValue(hit("bare-glob"));
    await evaluateBash("ls", context);
    expect(unquotedGlob).toHaveBeenCalledWith("ls");
    expect(bareGlob).toHaveBeenCalledWith("ls", context);
  });
});

describe("the zsh glob qualifier", () => {
  it("blocks a qualifier in the command itself, naming it", async () => {
    vi.mocked(execGlobQualifier).mockImplementation((text) =>
      text === "ls *(e:'rm -rf /':)" ? "*(e:'rm -rf /':)" : undefined,
    );
    await evaluateBash("ls *(e:'rm -rf /':)", ctx);
    expect(block).toHaveBeenCalledWith(
      "unquoted-glob",
      expect.stringContaining(
        "*(e:'rm -rf /':) is a zsh glob qualifier that runs code",
      ),
    );
  });

  it("blocks a qualifier inside a script that bash -c runs", async () => {
    vi.mocked(splitSegments).mockReturnValue([["bash", "-c", "rm *(+f)"]]);
    vi.mocked(scriptOf).mockReturnValue("rm *(+f)");
    vi.mocked(execGlobQualifier).mockImplementation((text) =>
      text === "rm *(+f)" ? "*(+f)" : undefined,
    );
    await evaluateBash("bash -c 'rm *(+f)'", ctx);
    expect(block).toHaveBeenCalledWith(
      "unquoted-glob",
      expect.stringContaining("*(+f) is a zsh glob qualifier"),
    );
  });

  it("raises nothing when no qualifier runs code", async () => {
    await evaluateBash("ls *.ts", ctx);
    expect(block).not.toHaveBeenCalled();
  });
});

describe("the unquoted = word", () => {
  it("warns about a word that starts with an unquoted =, and suggests quoting it", async () => {
    vi.mocked(rawWords).mockReturnValue([
      { text: "=ls", glob: false, equals: true },
    ]);
    await evaluateBash("=ls -la", ctx);
    expect(warn).toHaveBeenCalledWith(
      "equals-word",
      expect.stringContaining(
        "=ls starts with an unquoted =, which zsh expands as a command lookup",
      ),
    );
  });

  it("does not check a command that uses [[ ]], where = is a comparison", async () => {
    vi.mocked(rawWords).mockReturnValue([
      { text: "=a", glob: false, equals: true },
    ]);
    await evaluateBash("[[ =a ]]", ctx);
    expect(warn).not.toHaveBeenCalled();
  });
});

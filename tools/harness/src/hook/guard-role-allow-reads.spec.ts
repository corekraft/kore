import { beforeEach, describe, expect, it, vi } from "vitest";
import { HC_READS, harnessHelp, readMayRun } from "./guard-role-allow.js";
import {
  commandLookup,
  gitReadMayRun,
  whichMayRun,
} from "./guard-role-reads.js";
import { bareAssignment, harnessAllowed } from "./guard-role-writes.js";
import { commandOf } from "./guard-shell.js";

// The shape checks of the seven reads are collaborators: guard-role-reads.spec.ts tests them.
vi.mock("./guard-shell.js");
vi.mock("./guard-role-reads.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  harnessAllowed: vi.fn(),
  bareAssignment: vi.fn(),
}));

const mayRun = (words: string[]): boolean => readMayRun(words, []);

beforeEach(() => {
  vi.mocked(commandOf).mockImplementation((tokens) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }));
  vi.mocked(harnessAllowed).mockReturnValue(false);
  vi.mocked(bareAssignment).mockReturnValue(false);
  vi.mocked(commandLookup).mockReturnValue(false);
  vi.mocked(gitReadMayRun).mockReturnValue(false);
  vi.mocked(whichMayRun).mockReturnValue(false);
});

describe("readMayRun: the seven reads (#847) are decided by guard-role-reads.ts", () => {
  it("allows a git read only when its exact shape check passes it, and never git fetch", () => {
    vi.mocked(gitReadMayRun).mockReturnValue(true);
    expect(mayRun(["git", "ls-tree", "HEAD"])).toBe(true);
    expect(vi.mocked(gitReadMayRun)).toHaveBeenCalledWith(["ls-tree", "HEAD"]);

    vi.mocked(gitReadMayRun).mockReturnValue(false);
    expect(mayRun(["git", "ls-tree", "HEAD"])).toBe(false);
    expect(mayRun(["git", "fetch", "origin"])).toBe(false);
  });

  it("refuses a passed git read that carries a writing option before it", () => {
    vi.mocked(gitReadMayRun).mockReturnValue(true);
    expect(mayRun(["git", "--git-dir=/e", "ls-tree", "HEAD"])).toBe(false);
    expect(mayRun(["git", "ls-tree", "--output=f", "HEAD"])).toBe(false);
  });

  it("allows which and command -v only when their shape checks pass them", () => {
    vi.mocked(whichMayRun).mockReturnValue(true);
    expect(mayRun(["which", "git"])).toBe(true);
    vi.mocked(whichMayRun).mockReturnValue(false);
    expect(mayRun(["which", "git"])).toBe(false);

    vi.mocked(commandLookup).mockReturnValue(true);
    expect(mayRun(["command", "-v", "git"])).toBe(true);
    vi.mocked(commandLookup).mockReturnValue(false);
    expect(mayRun(["command", "-v", "git"])).toBe(false);
  });
});

describe("harnessHelp: node harness.mjs --help and nothing else", () => {
  it.each([
    ["node", ["skills/bin/harness.mjs", "--help"], true],
    ["node", ["./skills/bin/harness.mjs", "--help"], true],
    ["node", ["skills/bin/harness.mjs"], false],
    ["node", ["skills/bin/harness.mjs", "--version"], false],
    ["node", ["skills/bin/harness.mjs", "--help", "x"], false],
    ["node", ["skills/bin/harness.mjs", "flag", "--help"], false],
    ["node", ["other.mjs", "--help"], false],
    ["node", ["--eval", "x", "skills/bin/harness.mjs", "--help"], false],
    ["bash", ["skills/bin/harness.mjs", "--help"], false],
  ])("%s %j is %s", (name, args, allowed) => {
    expect(harnessHelp(name, args)).toBe(allowed);
  });

  it("lets readMayRun run it as a read", () => {
    expect(mayRun(["node", "skills/bin/harness.mjs", "--help"])).toBe(true);
    expect(mayRun(["node", "skills/bin/harness.mjs", "--version"])).toBe(false);
  });
});

describe("readMayRun: the hc reads a read-only role may run (plan 16, Step 4)", () => {
  const hcMayRun = (
    words: string[],
    reads: readonly string[] = HC_READS,
  ): boolean => readMayRun(words, [], reads);

  it.each([
    ["hc", "get", "t1", "--json"],
    ["hc", "ls", "--json"],
    ["hc", "read", "--json", "--lines", "20", "t1"],
    ["hc", "wait", "--json", "--timeout", "5", "t1"],
    ["hc", "get", "--help"],
    ["hc", "--help"],
    ["hc", "-h"],
  ])(
    "allows %j, an hc read, to a role that names the hc reads",
    (...words: string[]) => {
      expect(hcMayRun(words)).toBe(true);
    },
  );

  it.each([
    ["hc", "send", "t1", "hi"],
    ["hc", "label", "t1", "kore-role=writer"],
    ["hc", "run", "--bg", "--", "ls"],
    ["hc", "exec", "t1", "--", "ls"],
    ["hc", "kill", "t1"],
    ["hc", "--version"],
    ["hc", "run", "--help"],
    ["hc", "--help", "run"],
  ])("refuses %j, which no hc read is", (...words: string[]) => {
    expect(hcMayRun(words)).toBe(false);
  });

  it("gives the judge no hc read, so every hc command is refused with an empty list", () => {
    expect(hcMayRun(["hc", "get", "t1"], [])).toBe(false);
    expect(hcMayRun(["hc", "--help"], [])).toBe(false);
  });
});

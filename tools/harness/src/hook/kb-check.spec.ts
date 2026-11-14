import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  unprovenFlags,
  unprovenLine,
  FlagError,
  type UnprovenFlag,
} from "../flag/index.js";
import type { CliDeps, RunResult, Runner } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";
import { run, type KbDeps } from "../kb/index.js";
import { skillAudit } from "../skill/index.js";
import { kbCheck } from "./kb-check.js";

vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  unprovenFlags: vi.fn(),
  unprovenLine: vi.fn(),
}));
vi.mock("../kb/index.js");
vi.mock("../skill/index.js");

const ROOT = "/repo";
const FS = { readFile: vi.fn<(path: string) => Promise<string>>() };
const CLOCK = { tag: "clock" };
const git = vi.fn<Runner["run"]>();

/** The one assertion: a fake whose members the unit reads only through the mocked checks and the runner. */
const asCliDeps = (parts: object) => parts as CliDeps;
const deps = asCliDeps({
  root: () => Promise.resolve(ROOT),
  runner: { run: git },
  fs: FS,
  clock: CLOCK,
});

const ok = (stdout = "", code = 0, stderr = ""): RunResult => ({
  code,
  stdout,
  stderr,
});

/** git answers by its first argument, as the unit asks it: ls-files lists, log dates, config reads core.bare. */
function gitAnswers(answers: Record<string, RunResult>) {
  git.mockImplementation((_command, args) =>
    Promise.resolve(answers[args[0] ?? ""] ?? ok()),
  );
}

/** The deps kbCheck handed to the knowledge run, read from the call it made. */
/** The deps kbCheck handed to the knowledge run, read from the call it made; kbCheck sets every member. */
const kbDepsOf = (): Required<KbDeps> => {
  const call = vi.mocked(run).mock.calls.at(0);
  if (call === undefined) {
    throw new Error("kbCheck did not start the knowledge run");
  }
  return call[1] as Required<KbDeps>;
};

beforeEach(() => {
  gitAnswers({});
  FS.readFile.mockResolvedValue("");
  vi.mocked(run).mockResolvedValue(0);
});

describe("kbCheck: how it runs the knowledge check", () => {
  it("passes --strict to the check only when strict is set", async () => {
    await kbCheck(true, deps);
    await kbCheck(false, deps);

    expect(run).toHaveBeenNthCalledWith(
      1,
      ["--strict"],
      expect.anything(),
      expect.any(Function),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      [],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("returns the check's exit code and prints each line it logs on its own line", async () => {
    vi.mocked(run).mockImplementation(async (_argv, _kb, log) => {
      log("first finding");
      log("second finding");
      return 1;
    });

    expect(await kbCheck(false, deps)).toEqual({
      code: 1,
      stdout: "first finding\nsecond finding\n",
    });
  });

  it("prints nothing and exits 0 when the check logs no finding", async () => {
    expect(await kbCheck(false, deps)).toEqual({ code: 0, stdout: "" });
  });
});

describe("kbCheck: the files it reads", () => {
  it("lists the tracked and untracked files git reports, split on NUL", async () => {
    gitAnswers({ "ls-files": ok("a.md\0b.md\0") });
    await kbCheck(false, deps);

    expect(kbDepsOf().files()).toEqual(["a.md", "b.md"]);
    expect(git.mock.calls).toContainEqual([
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT },
    ]);
  });

  it("returns each file's text by path, and null for a path that is not in the tree", async () => {
    gitAnswers({ "ls-files": ok("a.md\0") });
    FS.readFile.mockResolvedValue("# A");
    await kbCheck(false, deps);

    expect(kbDepsOf().read("a.md")).toBe("# A");
    expect(kbDepsOf().read("missing.md")).toBeNull();
    expect(FS.readFile).toHaveBeenCalledWith(`${ROOT}/a.md`);
  });

  it("drops a listed file that vanished or is a folder, and keeps the rest", async () => {
    gitAnswers({ "ls-files": ok("gone.md\0folder\0kept.md\0") });
    FS.readFile.mockImplementation((path) => {
      if (path.endsWith("gone.md")) {
        return Promise.reject(
          Object.assign(new Error("gone"), { code: "ENOENT" }),
        );
      }
      if (path.endsWith("folder")) {
        return Promise.reject(
          Object.assign(new Error("dir"), { code: "EISDIR" }),
        );
      }
      return Promise.resolve("kept");
    });
    await kbCheck(false, deps);

    expect(kbDepsOf().files()).toEqual(["kept.md"]);
    expect(kbDepsOf().read("gone.md")).toBeNull();
  });

  it("fails the check on an unexpected read error, rather than reporting a clean tree", async () => {
    gitAnswers({ "ls-files": ok("a.md\0") });
    FS.readFile.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );

    await expect(kbCheck(false, deps)).rejects.toThrow("denied");
  });
});

describe("kbCheck: the commit date of a file", () => {
  it("returns the date of the last commit that touched the file", async () => {
    gitAnswers({ "ls-files": ok(), log: ok("2026-01-02\n") });
    await kbCheck(false, deps);

    expect(await kbDepsOf().commitDate("a.md")).toBe("2026-01-02");
    expect(git.mock.calls).toContainEqual([
      "git",
      ["log", "-1", "--format=%cs", "--", "a.md"],
      { cwd: ROOT },
    ]);
  });

  it("returns null when git has no commit for the file", async () => {
    gitAnswers({ "ls-files": ok(), log: ok("\n") });
    await kbCheck(false, deps);

    expect(await kbDepsOf().commitDate("new.md")).toBeNull();
  });

  it("rejects with git's own reason when git log fails, rather than inventing a date", async () => {
    gitAnswers({ "ls-files": ok(), log: ok("", 128, "fatal: bad\n") });
    await kbCheck(false, deps);

    await expect(kbDepsOf().commitDate("a.md")).rejects.toThrow(
      new CommandError("git log -1 --format=%cs -- a.md failed: fatal: bad"),
    );
  });
});

describe("kbCheck: the skill and flag audits", () => {
  it("runs the skill audit against the repository root and returns its report", async () => {
    const report = { text: "skill ok", failing: false };
    vi.mocked(skillAudit).mockResolvedValue(report);
    await kbCheck(false, deps);

    expect(await kbDepsOf().audit()).toEqual(report);
    expect(skillAudit).toHaveBeenCalledWith(FS, ROOT);
  });

  it("reports no line when every flag that is on has live proof", async () => {
    vi.mocked(unprovenFlags).mockResolvedValue([]);
    await kbCheck(false, deps);

    expect(await kbDepsOf().flagAudit()).toEqual([]);
    expect(unprovenFlags).toHaveBeenCalledWith(FS, CLOCK, ROOT);
  });

  it("reports each unproven flag as its own line", async () => {
    const flag: UnprovenFlag = {
      flag: "alpha",
      environment: "local",
      path: "/repo/overlay.yaml",
    };
    vi.mocked(unprovenFlags).mockResolvedValue([flag]);
    vi.mocked(unprovenLine).mockReturnValue("alpha has no proof");
    await kbCheck(false, deps);

    expect(await kbDepsOf().flagAudit()).toEqual(["alpha has no proof"]);
    expect(vi.mocked(unprovenLine).mock.calls[0]?.[0]).toBe(flag);
  });

  it("reports a flag error's lines as they are", async () => {
    vi.mocked(unprovenFlags).mockRejectedValue(
      new FlagError("overlay is broken\nsecond line\n"),
    );
    await kbCheck(false, deps);

    expect(await kbDepsOf().flagAudit()).toEqual([
      "overlay is broken",
      "second line",
    ]);
  });

  it("names the cause and the command that shows it when the audit cannot run for another reason", async () => {
    vi.mocked(unprovenFlags).mockRejectedValue(new Error("disk gone\nmore"));
    await kbCheck(false, deps);

    expect(await kbDepsOf().flagAudit()).toEqual([
      "flag audit could not run (disk gone); run `node skills/bin/harness.mjs flag audit` to see the cause",
    ]);
  });
});

describe("kbCheck: the repository's own git config", () => {
  it("reports nothing when core.bare is unset, which git signals with exit 1", async () => {
    gitAnswers({ "ls-files": ok(), config: ok("", 1) });
    await kbCheck(false, deps);

    expect(await kbDepsOf().repositoryProblems()).toEqual([]);
  });

  it("reports nothing when core.bare is false", async () => {
    gitAnswers({ "ls-files": ok(), config: ok("false\n") });
    await kbCheck(false, deps);

    expect(await kbDepsOf().repositoryProblems()).toEqual([]);
  });

  it("reports the fix when core.bare is true, which breaks git pull in the main checkout", async () => {
    gitAnswers({ "ls-files": ok(), config: ok("true\n") });
    await kbCheck(false, deps);

    const problems = await kbDepsOf().repositoryProblems();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("core.bare is true");
    expect(problems[0]).toContain("git config core.bare false");
  });

  it("rejects when git cannot read the config, rather than reporting it clean", async () => {
    gitAnswers({ "ls-files": ok(), config: ok("", 3, "boom\n") });
    await kbCheck(false, deps);

    await expect(kbDepsOf().repositoryProblems()).rejects.toThrow(
      new CommandError("git config --get core.bare failed: boom"),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkOrFolder, isRegularFile } from "./guard-role-links.js";
import { isHookTest, stagesHookTest } from "./guard-role-stage.js";
import { splitSegments } from "./guard-shell.js";

vi.mock("./guard-role-links.js");
vi.mock("./guard-shell.js");

const ROOT = "/repo";
const TEST = ".claude/hooks/workflow.test.mjs";
/** A hook test path that is a symlink or a folder on disk, or missing: not a regular file. */
const NOT_REGULAR = "/repo/.claude/hooks/link.test.mjs";

/** The shell, faked as whitespace words in `&&`-separated segments. Quoting and escapes are guard-shell.spec.ts's job. */
const shellFake = (command: string): string[][] =>
  command.split("&&").map((segment) => segment.trim().split(/\s+/));

const stages = (command: string): boolean => stagesHookTest(ROOT, command);

beforeEach(() => {
  vi.mocked(splitSegments).mockImplementation(shellFake);
  vi.mocked(isLinkOrFolder).mockReturnValue(false);
  vi.mocked(isRegularFile).mockImplementation((path) => path !== NOT_REGULAR);
});

describe("stagesHookTest: a writer stages one plain hook test with git add or git commit", () => {
  it("passes git add of one regular hook test file", () => {
    expect(stages(`git add ${TEST}`)).toBe(true);
  });

  it("passes git commit of one hook test with -m, --message or the -- separator before it", () => {
    expect(stages(`git commit -m fix ${TEST}`)).toBe(true);
    expect(stages(`git commit -m fix -- ${TEST}`)).toBe(true);
    expect(stages(`git commit --message=fix ${TEST}`)).toBe(true);
    expect(stages(`git commit --message fix -- ${TEST}`)).toBe(true);
    expect(stages(`git commit -- ${TEST}`)).toBe(true);
  });

  it("passes a hook test named by its absolute path inside the repository, checked on disk", () => {
    expect(stages(`git add /repo/${TEST}`)).toBe(true);
    expect(isRegularFile).toHaveBeenCalledWith(`/repo/${TEST}`);
  });

  it("refuses any other hook file, the settings, the bundle, a folder or skills/bin", () => {
    expect(stages("git add .claude/hooks/guard.sh")).toBe(false);
    expect(stages("git add .claude/settings.json")).toBe(false);
    expect(stages("git add .claude/settings.local.json")).toBe(false);
    expect(stages("git add .claude")).toBe(false);
    expect(stages("git add skills/bin/harness.mjs")).toBe(false);
    expect(stages("git add src/app.ts")).toBe(false);
  });

  it("refuses a name that is not a plain test directly in .claude/hooks", () => {
    expect(stages("git add .claude/hooks/sub/a.test.mjs")).toBe(false);
    expect(stages("git add .claude/hooks/a.test.ts")).toBe(false);
    expect(stages("git add .claude/hooks/.a.test.mjs")).toBe(false);
    expect(stages("git add .claude/hooks/a b.test.mjs")).toBe(false);
  });

  it("refuses a glob, a climb, a variable or a brace in the test name", () => {
    expect(stages("git add .claude/hooks/*.test.mjs")).toBe(false);
    expect(stages("git add .claude/hooks/../hooks/workflow.test.mjs")).toBe(
      false,
    );
    expect(stages("git add /repo/.claude/hooks/../hooks/a.test.mjs")).toBe(
      false,
    );
    expect(stages("git add .claude/hooks/{a,b}.test.mjs")).toBe(false);
    expect(stages("git add .claude/hooks/$NAME.test.mjs")).toBe(false);
  });

  it("refuses a symlink, a folder or a missing file under a test name, checked on disk", () => {
    expect(stages("git add .claude/hooks/link.test.mjs")).toBe(false);
    expect(isRegularFile).toHaveBeenCalledWith(NOT_REGULAR);
    expect(stages("git commit -m fix -- .claude/hooks/link.test.mjs")).toBe(
      false,
    );
  });

  it("refuses a stage that names two paths or uses a flag other than -m, --message or --", () => {
    expect(stages(`git add ${TEST} .claude/hooks/b.test.mjs`)).toBe(false);
    expect(stages(`git add -f ${TEST}`)).toBe(false);
    expect(stages(`git add -A ${TEST}`)).toBe(false);
    expect(stages(`git commit -a -m fix ${TEST}`)).toBe(false);
    expect(stages("git commit -m fix")).toBe(false);
    expect(stages("git add")).toBe(false);
  });
});

describe("stagesHookTest: a stage that is chained, substituted or another verb is refused", () => {
  it("refuses a chained command, a substitution, or a process substitution around the stage", () => {
    expect(
      stages(
        `git add ${TEST} && git commit -m fix -- .claude/hooks/b.test.mjs`,
      ),
    ).toBe(false);
    expect(stages(`git commit -m $(echo hi) ${TEST}`)).toBe(false);
    expect(stages(`git commit -m \`echo hi\` ${TEST}`)).toBe(false);
    expect(stages(`git add <(echo) ${TEST}`)).toBe(false);
  });

  it("refuses another git verb or command that names a hook test, such as restore or cp", () => {
    expect(stages(`git restore ${TEST}`)).toBe(false);
    expect(stages(`git rm ${TEST}`)).toBe(false);
    expect(stages(`git checkout ${TEST}`)).toBe(false);
    expect(stages(`cp ${TEST} .claude/hooks/guard.sh`)).toBe(false);
    expect(stages("git")).toBe(false);
  });
});

describe("isHookTest: a hook test by its literal name", () => {
  it("passes a literal test name directly in .claude/hooks that is not a link or folder", () => {
    expect(isHookTest(ROOT, TEST)).toBe(true);
    expect(isLinkOrFolder).toHaveBeenCalledWith(`/repo/${TEST}`);
    expect(isRegularFile).not.toHaveBeenCalled();
  });

  it("refuses a name that is a link or folder when it is not checked as a regular file", () => {
    vi.mocked(isLinkOrFolder).mockReturnValue(true);
    expect(isHookTest(ROOT, TEST)).toBe(false);
  });

  it("requires a regular file on disk when asked to check existence", () => {
    expect(isHookTest(ROOT, NOT_REGULAR.slice(ROOT.length + 1), true)).toBe(
      false,
    );
    expect(isHookTest(ROOT, TEST, true)).toBe(true);
    expect(isRegularFile).toHaveBeenCalledWith(`/repo/${TEST}`);
  });

  it("takes an absolute path inside the root, and refuses one outside it or with a climb", () => {
    expect(isHookTest(ROOT, `/repo/${TEST}`)).toBe(true);
    expect(isHookTest(ROOT, "/elsewhere/.claude/hooks/a.test.mjs")).toBe(false);
    expect(isHookTest(ROOT, "/repo/.claude/hooks/../a.test.mjs")).toBe(false);
  });
});

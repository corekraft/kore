import { beforeEach, expect, it, vi } from "vitest";
import { shellText } from "./guard-shell.js";
import { unquotedGlob } from "./guard-unquoted-glob.js";

vi.mock("./guard-shell.js", () => ({ shellText: vi.fn() }));
vi.mock("./guard-verdict.js", () => ({
  block: vi.fn((rule: string, message: string) => ({
    action: "block",
    rule,
    message: `[guard:${rule}] ${message}`,
  })),
}));

const REASON = (flag: string, glob: string) =>
  `--${flag}=${glob} is unquoted; zsh fails the whole command when the glob matches no file. `;

const CORRECTED = (flag: string, glob: string, corrected: string) =>
  `[guard:unquoted-glob] ${REASON(flag, glob)}Instead, run: ${corrected}`;

const FLAG_ONLY = (flag: string, glob: string, quoted: string) =>
  `[guard:unquoted-glob] ${REASON(flag, glob)}Instead, quote it if it must stay literal: --${flag}='${quoted}'. No corrected command is offered.`;

beforeEach(() => {
  // The first line of the command is the checked text; the mock returns the whole command.
  vi.mocked(shellText).mockImplementation((command: string) => command);
});

it("unquoted-glob: the block message carries the exact corrected command, with the glob quoted", () => {
  expect(unquotedGlob("grep -rn foo --include=*.ts tools/kore/src")).toEqual({
    action: "block",
    rule: "unquoted-glob",
    message: CORRECTED(
      "include",
      "*.ts",
      "grep -rn foo --include='*.ts' tools/kore/src",
    ),
  });
});

it("unquoted-glob: every unquoted --include or --exclude glob is quoted in the corrected command", () => {
  expect(
    unquotedGlob("grep -e a --include=*.ts --exclude=*.spec.ts src"),
  ).toEqual({
    action: "block",
    rule: "unquoted-glob",
    message: CORRECTED(
      "include",
      "*.ts",
      "grep -e a --include='*.ts' --exclude='*.spec.ts' src",
    ),
  });
});

it("unquoted-glob: a pipe, && or redirect after the glob stays as written in the corrected command", () => {
  expect(unquotedGlob("grep -rn foo --exclude=*.spec.ts src | head")).toEqual({
    action: "block",
    rule: "unquoted-glob",
    message: CORRECTED(
      "exclude",
      "*.spec.ts",
      "grep -rn foo --exclude='*.spec.ts' src | head",
    ),
  });
  expect(unquotedGlob("grep --include=*.ts|head x")?.message).toBe(
    CORRECTED("include", "*.ts", "grep --include='*.ts'|head x"),
  );
  expect(unquotedGlob("grep --include=*.ts && echo ok")?.message).toBe(
    CORRECTED("include", "*.ts", "grep --include='*.ts' && echo ok"),
  );
  expect(unquotedGlob("grep --include=*.ts>out.txt x")?.message).toBe(
    CORRECTED("include", "*.ts", "grep --include='*.ts'>out.txt x"),
  );
});

it("unquoted-glob: a heredoc body is never echoed into the message; the rule gives the flag-only advice", () => {
  vi.mocked(shellText).mockReturnValueOnce("grep --include=*.ts x <<'EOF'");
  const result = unquotedGlob("grep --include=*.ts x <<'EOF'\nbody\nEOF");
  expect(result?.message).toBe(FLAG_ONLY("include", "*.ts", "*.ts"));
  expect(result?.message).not.toContain("body");
});

it("unquoted-glob: a command longer than 300 characters gets the flag-only advice, not a corrected command", () => {
  const command = `grep --include=*.ts ${"x".repeat(300)} src`;
  expect(unquotedGlob(command)?.message).toBe(
    FLAG_ONLY("include", "*.ts", "*.ts"),
  );
});

it("unquoted-glob: an unquoted glob inside a quoted span gets the flag-only advice, since a corrected command would break the quoting", () => {
  expect(unquotedGlob("bash -c 'grep --include=*.ts x'")?.message).toBe(
    FLAG_ONLY("include", "*.ts", "*.ts"),
  );
  expect(unquotedGlob('git commit -m "note: --include=*.md"')?.message).toBe(
    FLAG_ONLY("include", "*.md", "*.md"),
  );
});

it("unquoted-glob: a glob with brace, variable, or backslash syntax gets the flag-only advice, since quoting it changes what it matches", () => {
  expect(unquotedGlob("grep --include=*.{ts,tsx} src")?.message).toBe(
    `[guard:unquoted-glob] ${REASON("include", "*.{ts,tsx}")}Instead, write one quoted --include per alternative of the brace list. No corrected command is offered.`,
  );
  expect(unquotedGlob("grep --include=*.$ext src")?.message).toBe(
    FLAG_ONLY("include", "*.$ext", "*.$ext"),
  );
  expect(unquotedGlob("grep --include=\\*.ts src")?.message).toBe(
    FLAG_ONLY("include", "\\*.ts", "\\*.ts"),
  );
});

it("unquoted-glob: a glob outside the plain set is still blocked, with the flag-only advice", () => {
  for (const [command, flag, glob] of [
    ["grep --include=(*.ts|*.tsx) src", "include", "(*.ts|*.tsx)"],
    ["grep --exclude=!(*.ts) src", "exclude", "!(*.ts)"],
    ["grep --include=a.ts>out* src", "include", "a.ts>out*"],
  ] as [string, string, string][]) {
    const result = unquotedGlob(command);
    expect(result?.action, command).toBe("block");
    expect(result?.rule, command).toBe("unquoted-glob");
    expect(result?.message, command).toBe(FLAG_ONLY(flag, glob, glob));
  }
});

it("unquoted-glob: a corrected command leaves quoted text and quoted flags exactly as written", () => {
  expect(
    unquotedGlob("grep --include=*.ts 'x --exclude=*.md' src")?.message,
  ).toBe(
    CORRECTED(
      "include",
      "*.ts",
      "grep --include='*.ts' 'x --exclude=*.md' src",
    ),
  );
  expect(
    unquotedGlob("grep --include='*.ts' --exclude=*.spec.ts src")?.message,
  ).toBe(
    CORRECTED(
      "exclude",
      "*.spec.ts",
      "grep --include='*.ts' --exclude='*.spec.ts' src",
    ),
  );
});

it("unquoted-glob: quoted globs, globless flags and commands without the flags return no finding", () => {
  for (const command of [
    "grep -rn foo --include='*.ts' src",
    'grep -rn foo "--include=*.ts" src',
    "grep -rn foo --include=app.ts src",
    "ls infra/*.yaml",
  ]) {
    expect(unquotedGlob(command), command).toBeNull();
  }
});

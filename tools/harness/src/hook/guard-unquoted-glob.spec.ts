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

const RULE_MESSAGE = (flag: string, glob: string, corrected: string) =>
  `--${flag}=${glob} is unquoted; zsh fails the whole command when the glob matches no file. ` +
  `Instead, run: ${corrected}`;

beforeEach(() => {
  // The first line of the command is the checked text; the mock returns the whole command.
  vi.mocked(shellText).mockImplementation((command: string) => command);
});

it("unquoted-glob: the block message carries the exact corrected command, with the glob quoted", () => {
  expect(unquotedGlob("grep -rn foo --include=*.ts tools/kore/src")).toEqual({
    action: "block",
    rule: "unquoted-glob",
    message: `[guard:unquoted-glob] ${RULE_MESSAGE("include", "*.ts", "grep -rn foo --include='*.ts' tools/kore/src")}`,
  });
});

it("unquoted-glob: every unquoted --include or --exclude glob is quoted in the corrected command", () => {
  expect(
    unquotedGlob("grep -e a --include=*.ts --exclude=*.spec.ts src"),
  ).toEqual({
    action: "block",
    rule: "unquoted-glob",
    message: `[guard:unquoted-glob] ${RULE_MESSAGE("include", "*.ts", "grep -e a --include='*.ts' --exclude='*.spec.ts' src")}`,
  });
});

it("unquoted-glob: a pipe after the glob stays a pipe in the corrected command", () => {
  const result = unquotedGlob("grep -rn foo --exclude=*.spec.ts src | head");
  expect(result?.message).toBe(
    `[guard:unquoted-glob] ${RULE_MESSAGE("exclude", "*.spec.ts", "grep -rn foo --exclude='*.spec.ts' src | head")}`,
  );
  expect(
    unquotedGlob("grep --include=*.ts|head x")?.message.endsWith(
      "Instead, run: grep --include='*.ts'|head x",
    ),
  ).toBe(true);
});

it("unquoted-glob: text after a heredoc marker is kept as it was in the corrected command", () => {
  vi.mocked(shellText).mockReturnValueOnce("grep --include=*.ts x <<'EOF'");
  const result = unquotedGlob("grep --include=*.ts x <<'EOF'\nbody\nEOF");
  expect(result?.message).toBe(
    `[guard:unquoted-glob] ${RULE_MESSAGE("include", "*.ts", "grep --include='*.ts' x <<'EOF'\nbody\nEOF")}`,
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

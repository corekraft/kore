import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { committedInventoryText } from "../testing/index.js";

// The three zsh rules (unquoted-glob, equals-word, bare-glob) as the host runs the hook: they
// skip only when the hook's own environment names bash, and keep guarding under zsh, an unknown
// shell or none, and only while the shell-aware-zsh-rules flag is on in the local overlay.
// CLAUDE_CODE_SHELL is read first, then SHELL; nothing an agent can write is read.
const OVERLAY = "/repo/infra/environments/local/environment.yaml";
const overlayWith = (flag: boolean) =>
  JSON.stringify({ features: { "shell-aware-zsh-rules": flag } });

async function guard(
  command: string,
  shell: Record<string, string>,
  overlay: string | null = overlayWith(true),
) {
  const h = testHarness({
    env: {
      CLAUDE_PROJECT_DIR: "/repo",
      KORE_ROOT: "/repo",
      HOME: "/home/test",
      ...shell,
    },
    files: {
      [`/repo/${INVENTORY_PATH}`]: committedInventoryText,
      ...(overlay === null ? {} : { [OVERLAY]: overlay }),
    },
  });
  h.deps.stdin = () =>
    Promise.resolve(
      JSON.stringify({
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command },
      }),
    );
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out(), err: h.err() };
}

const UNQUOTED = "grep -r --include=*.ts foo .";
const EQUALS = "echo =ls";
const BARE = "ls infra/*.zzz";

const SHELLS: [string, Record<string, string>][] = [
  ["zsh", { CLAUDE_CODE_SHELL: "/bin/zsh", SHELL: "/bin/zsh" }],
  ["an unknown shell", { CLAUDE_CODE_SHELL: "/usr/bin/fish" }],
  ["no shell variable at all", {}],
  ["an empty CLAUDE_CODE_SHELL and no SHELL", { CLAUDE_CODE_SHELL: "" }],
  [
    "a CLAUDE_CODE_SHELL of zsh over a SHELL of bash",
    { CLAUDE_CODE_SHELL: "/bin/zsh", SHELL: "/bin/bash" },
  ],
  ["a shell whose name only contains bash", { SHELL: "/bin/notbash" }],
  ["a shell path that is not an executable name", { SHELL: "bash -c id" }],
];

describe("the zsh rules keep guarding unless the shell is verified bash", () => {
  for (const [label, shell] of SHELLS) {
    it(`blocks an unquoted --include glob under ${label}`, async () => {
      const result = await guard(UNQUOTED, shell);
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/^\[guard:unquoted-glob\] --include=\*\.ts/);
    });

    it(`blocks an unquoted = word under ${label}`, async () => {
      const result = await guard(EQUALS, shell);
      expect(result.code).toBe(2);
      expect(result.err).toMatch(
        /^\[guard:equals-word\] =ls starts with an unquoted =/,
      );
    });

    it(`warns about a bare glob that matches nothing under ${label}`, async () => {
      const result = await guard(BARE, shell);
      expect(result.code).toBe(0);
      expect(
        JSON.parse(result.out).hookSpecificOutput.additionalContext,
      ).toMatch(/^\[guard:bare-glob\] infra\/\*\.zzz is an unquoted glob/);
    });
  }
});

const BASH: [string, Record<string, string>][] = [
  ["CLAUDE_CODE_SHELL", { CLAUDE_CODE_SHELL: "/opt/homebrew/bin/bash" }],
  ["a bare bash name", { CLAUDE_CODE_SHELL: "bash" }],
  [
    "CLAUDE_CODE_SHELL over a zsh SHELL",
    { CLAUDE_CODE_SHELL: "/bin/bash", SHELL: "/bin/zsh" },
  ],
  ["SHELL when CLAUDE_CODE_SHELL is unset", { SHELL: "/bin/bash" }],
  [
    "SHELL when CLAUDE_CODE_SHELL is empty",
    { CLAUDE_CODE_SHELL: "", SHELL: "/usr/local/bin/bash" },
  ],
];

describe("the zsh rules skip under a verified bash", () => {
  for (const [label, shell] of BASH) {
    it(`lets an unquoted --include glob through, named by ${label}`, async () => {
      expect(await guard(UNQUOTED, shell)).toEqual({
        code: 0,
        out: "",
        err: "",
      });
    });

    it(`stays silent about an unquoted = word, named by ${label}`, async () => {
      expect(await guard(EQUALS, shell)).toEqual({
        code: 0,
        out: "",
        err: "",
      });
    });

    it(`stays silent about a bare glob that matches nothing, named by ${label}`, async () => {
      expect(await guard(BARE, shell)).toEqual({
        code: 0,
        out: "",
        err: "",
      });
    });
  }

  it.each([
    ["off in the local overlay", overlayWith(false)],
    ["not written in the local overlay", JSON.stringify({ features: {} })],
    ["in a malformed overlay", "not json"],
    ["without any overlay", null],
  ])(
    "keeps blocking and warning under bash when the flag is %s",
    async (_label, overlay) => {
      const bash = { CLAUDE_CODE_SHELL: "/bin/bash" };
      expect((await guard(UNQUOTED, bash, overlay)).code).toBe(2);
      expect((await guard(EQUALS, bash, overlay)).code).toBe(2);
      expect(
        JSON.parse((await guard(BARE, bash, overlay)).out).hookSpecificOutput
          .additionalContext,
      ).toMatch(/^\[guard:bare-glob\]/);
    },
  );

  it("still blocks a zsh glob qualifier that runs code, which no shell setting excuses", async () => {
    const result = await guard("ls *(e:'id':)", {
      CLAUDE_CODE_SHELL: "/bin/bash",
    });
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/is a zsh glob qualifier that runs code/);
  });
});

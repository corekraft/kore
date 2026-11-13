// A deterministic corpus of bypass attempts against `hook guard` (retro finding 9, #335).
// Each case is a call the guard must refuse, with the rule that refuses it; each `ORDINARY`
// case is a call that must keep passing. The spec runs both through the hook, in CI `check`,
// and fails on any ALLOW for a corpus case. A bypass the retro or a review finds is added
// here first, as a failing case, and then closed.

export interface CorpusCase {
  /** The role the session runs as, or none for the person's own session. */
  role?: string;
  tool: "Bash" | "Write" | "Edit" | "Read" | "Grep" | "Glob";
  /** A command for Bash; a path for the file tools. */
  input: string;
  /** The rule whose block message must come back. */
  rule: string;
}

const READ_ONLY = ["concierge", "reader", "refiner", "challenger"];
const REPORTING = ["orchestrator", "judge"];
const NO_CODE = ["concierge", "challenger"];
const ROLES = [...READ_ONLY, ...REPORTING];

const bash = (role: string, rule: string, ...commands: string[]) =>
  commands.map((input): CorpusCase => ({ role, tool: "Bash", input, rule }));
const eachRole = (
  roles: readonly string[],
  rule: string,
  ...commands: string[]
) => roles.flatMap((role) => bash(role, rule, ...commands));

/** `echo x>file` writes with no space before `>`; the read-only roles never write. */
const GLUED_REDIRECTS = eachRole(
  ROLES,
  "role-read-only",
  "echo x>file",
  "echo x>>file",
  "echo x 2>err",
  "echo x&>file",
  "echo x>file.txt && ls",
  "cat a>out",
  "echo x >| file",
  "echo x>|file",
);

/** A zsh glob qualifier runs code in `e:'...':`, and `+func` calls a function. */
const GLOB_QUALIFIERS = [undefined, "writer", "reader", "judge"].flatMap(
  (role) =>
    [
      "ls *(e:'touch pwned':)",
      "echo *(.e:'id':)",
      "cat ?(e:'id':)",
      "ls **/*(+evil)",
      "ls *(N.e:'id':)",
      "echo a(e:'touch p':)",
      "echo {a,b}(e:'touch p':)",
    ].map((input): CorpusCase => {
      const base = {
        tool: "Bash" as const,
        input,
        rule: "unquoted-glob",
      };
      return role === undefined ? base : { ...base, role };
    }),
);

/** A shell given the qualifier as a script: only the sessions with a full shell reach it. */
const GLOB_IN_SCRIPT = [undefined, "writer"].flatMap((role) =>
  [`zsh -c "ls *(e:'id':)"`, `bash -c "ls *(+evil)"`].map(
    (input): CorpusCase => {
      const base = { tool: "Bash" as const, input, rule: "unquoted-glob" };
      return role === undefined ? base : { ...base, role };
    },
  ),
);

const SECRET_PATHS = [
  "~/.ssh/id_ed25519",
  "$HOME/.ssh/id_rsa",
  "/home/u/.ssh/config",
  "~/.kube/config",
  "~/.config/gh/hosts.yml",
  "~/.s''sh/id_rsa",
  "~/.kube/conf*",
  "~//.ssh//id_rsa",
  "~/.ss*/id_rsa",
  "~/.config/g*/hosts.yml",
];

/** Every bounded role, the writer included, refuses host credentials. */
const SECRETS = [...ROLES, "writer"].flatMap((role) => [
  ...SECRET_PATHS.flatMap((path) =>
    bash(role, "secret-path", `cat ${path}`, `grep token ${path}`),
  ),
  ...["Read", "Grep", "Glob"].flatMap((tool): CorpusCase[] =>
    [
      "/home/u/.ssh/id_rsa",
      "/home/u/.kube/config",
      "~/.config/gh/",
      "/home/u//.kube//config",
      "~/.ss*/*",
      "/home/u/.kube/conf*",
    ].map((input) => ({
      role,
      tool: tool as "Read",
      input,
      rule: "secret-path",
    })),
  ),
]);

const PROTECTED_FILES = [
  "skills/bin/harness.mjs",
  "./skills/bin/harness.mjs",
  "skills/bin/../bin/harness.mjs",
  ".claude/hooks/harness.sh",
  ".claude/hooks/guard.sh",
  ".claude/hooks/new.sh",
  ".claude/settings.json",
];

/** The writer may not change the guard it runs under, neither the bundle nor the hooks. */
const GUARD_FILES = [
  ...PROTECTED_FILES.flatMap((file) =>
    (["Write", "Edit"] as const).map((tool): CorpusCase => ({
      role: "writer",
      tool,
      input: file,
      rule: "role-read-only",
    })),
  ),
  ...PROTECTED_FILES.flatMap((file) =>
    bash(
      "writer",
      "role-read-only",
      `echo x > ${file}`,
      `echo x >| ${file}`,
      `echo x>${file}`,
      `echo x >> ${file}`,
      `cp evil.mjs ${file}`,
      `mv evil.mjs ${file}`,
      `rm ${file}`,
      `sed -i s/a/b/ ${file}`,
      `printf x | tee ${file}`,
      `chmod +x ${file}`,
      `node -e "require('fs').writeFileSync('${file}','x')"`,
    ),
  ),
];

/** Cheap variants of the same: a glob on the path, a copy into the directory, the directory itself. */
const GUARD_PATH_VARIANTS = bash(
  "writer",
  "role-read-only",
  "echo x > skills/bin/harness.mj?",
  "echo x > skills/bin/harness.m*",
  "rm skills/bin/harness.mj?",
  "cp evil.mjs skills/bin/",
  "cp -t skills/bin evil.mjs",
  "cp -t .claude/hooks x.sh",
  "cp x.sh .claude/hooks/",
  "rm -rf .claude",
  "rm -rf .claude/h*",
  "echo x > .claude/settings.json",
  "echo x > .claude//hooks//guard.sh",
);

/** The writer may not flip a flag, record an outcome or dispatch a workflow: each is the person's or the orchestrator's call. */
const GATED = bash(
  "writer",
  "role-no-merge",
  "node --no-warnings skills/bin/harness.mjs flag activate x",
  "bash .claude/hooks/harness.sh flag activate x",
  "gh api repos/corekraft/kore/actions/workflows/check.yml/dispatches -f ref=main",
  "gh api -X POST /repos/corekraft/kore/dispatches",
  "node skills/bin/harness.mjs flag activate remote-thing --environment local",
  "node ./skills/bin/harness.mjs flag activate x",
  ".claude/hooks/harness.sh flag activate x",
  "node skills/bin/harness.mjs outcome record --idea 1",
  "env X=1 node skills/bin/harness.mjs flag activate x",
  "bash -c 'node skills/bin/harness.mjs flag activate x'",
  "echo $(node skills/bin/harness.mjs outcome record --idea 1)",
  "gh workflow run check.yml",
  "gh -R corekraft/kore workflow run check.yml",
  "gh workflow run nightly.yml --ref main",
  "time gh workflow run check.yml",
  "xargs gh workflow run",
  "echo hi && gh workflow run check.yml",
);

export const CORPUS: readonly CorpusCase[] = [
  ...GLUED_REDIRECTS,
  ...GLOB_QUALIFIERS,
  ...GLOB_IN_SCRIPT,
  ...SECRETS,
  ...GUARD_FILES,
  ...GUARD_PATH_VARIANTS,
  ...GATED,
];

export interface OrdinaryCase {
  role?: string;
  tool: CorpusCase["tool"];
  input: string;
  /** A Grep's search pattern, which may name anything. */
  pattern?: string;
}

const ordinary = (role: string | undefined, ...commands: string[]) =>
  commands.map((input): OrdinaryCase =>
    role === undefined
      ? { tool: "Bash", input }
      : { role, tool: "Bash", input },
  );

/** Calls the fixes must not catch: reads, null redirects, quoted `>`, harmless globs and the writer's ordinary work. */
export const ORDINARY: readonly OrdinaryCase[] = [
  ...ROLES.flatMap((role) =>
    ordinary(
      role,
      "echo hi>/dev/null",
      "echo hi 2>&1",
      "echo 'a>b'",
      'echo "a > b"',
      "git log --oneline -3",
      "echo *.md",
    ),
  ),
  // The no-code roles read plans and docs through the harness and git log, never the tree.
  ...ROLES.filter((role) => !NO_CODE.includes(role)).flatMap((role) =>
    ordinary(role, "ls docs", "cat docs/index.md"),
  ),
  ...ordinary(
    "writer",
    "echo hi > out.txt",
    "echo hi>out.txt",
    "cat .claude/hooks/guard.sh",
    "cat .claude/hooks/guard.sh > /tmp/guard-copy.sh",
    "grep -n guard skills/bin/harness.mjs",
    "ls *(.)",
    "ls *(om[1])",
    "echo $(date)",
    "mise run harness-build",
    "mise run format src/a.ts",
    "node skills/bin/harness.mjs plan active",
    "node skills/bin/harness.mjs flag audit",
    "gh workflow list",
    "gh workflow view check.yml",
    "gh pr create --fill-first",
    "git commit -m 'fix: x'",
    "grep -rn ssh src",
    "ls ~/Development",
    "git commit -m 'docs: explain ~/.kube/config handling'",
    "gh pr create --body 'reads ~/.ssh no more'",
    "gh pr create --title 'fix: stop reading .config/gh' --body x",
    "cat .claude/settings.json",
    "ls .claude skills/bin",
    "node --no-warnings skills/bin/harness.mjs plan active",
    "bash -c 'ls docs'",
    "echo a >| out.txt",
  ),
  ...ordinary(
    "reader",
    "grep -rn '.kube/config' docs",
    "echo 'see ~/.ssh docs'",
  ),
  ...ordinary(undefined, "git status", "ls *(.)", "echo hi>out.txt"),
  { role: "writer", tool: "Write", input: "src/a.ts" },
  { role: "writer", tool: "Edit", input: "docs/index.md" },
  { role: "writer", tool: "Read", input: ".claude/hooks/guard.sh" },
  { role: "writer", tool: "Grep", input: "src", pattern: ".kube/config" },
  { role: "reader", tool: "Grep", input: "docs", pattern: "~/.ssh" },
  { role: "reader", tool: "Read", input: "tools/harness/src/hook/guard.ts" },
];

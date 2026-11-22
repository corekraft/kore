import type { CorpusCase, OrdinaryCase } from "./guard-corpus.js";

const bash = (rule: string, ...commands: string[]) =>
  commands.map((input): CorpusCase => ({
    role: "writer",
    tool: "Bash",
    input,
    rule,
  }));

/** The bundle's gated pair, then --help or -h, run through node, a leading ./, or the bundle path alone. */
const HELP_REQUESTS = [
  "node skills/bin/harness.mjs flag activate --help",
  "node skills/bin/harness.mjs flag activate -h",
  "node skills/bin/harness.mjs outcome record --help",
  "node skills/bin/harness.mjs outcome record -h",
  "node ./skills/bin/harness.mjs flag activate --help",
  "skills/bin/harness.mjs flag activate --help",
];

/** Gated forms the help exemption never lets through, with the flag on or off. */
const HELP_NOT_EXEMPT = [
  "node skills/bin/harness.mjs flag activate x --help",
  "node skills/bin/harness.mjs outcome record --idea 1 -h",
  "node skills/bin/harness.mjs flag activate",
  "node skills/bin/harness.mjs flag activate --help --json",
  "harness flag activate --help",
  "node /tmp/harness.mjs flag activate --help",
  "bash .claude/hooks/harness.sh flag activate --help",
  "gh workflow run check.yml --help",
];

/** The help requests, refused while the flag is off, as they are today. */
export const HELP_REFUSED_FLAG_OFF: readonly CorpusCase[] = bash(
  "role-no-merge",
  ...HELP_REQUESTS,
);

/** Refused with the flag on too: the exemption matches only the bundle, the gated pair and one help flag. */
export const HELP_STILL_REFUSED: readonly CorpusCase[] = bash(
  "role-no-merge",
  ...HELP_NOT_EXEMPT,
);

/** Allowed with gated-help-exempt on, and refused with it off (HELP_REFUSED_FLAG_OFF). */
export const HELP_ALLOWED: readonly OrdinaryCase[] = HELP_REQUESTS.map(
  (input): OrdinaryCase => ({ role: "writer", tool: "Bash", input }),
);

const forRoles = (
  roles: readonly string[],
  rule: string,
  ...commands: string[]
): CorpusCase[] =>
  roles.flatMap((role) =>
    commands.map((input): CorpusCase => ({ role, tool: "Bash", input, rule })),
  );

const ORDINARY_ROLES = [
  "reader",
  "principles-review",
  "judgment",
  "judge",
  "writer",
];
const READ_ONLY_HELP_ROLES = [
  "reader",
  "principles-review",
  "judgment",
  "judge",
];

/** Help at the root, domain and command level, with and without --json, for a command that is not gated (#1802). */
const HELP_LEVELS = [
  "node skills/bin/harness.mjs --help",
  "node skills/bin/harness.mjs -h",
  "node skills/bin/harness.mjs --help --json",
  "node skills/bin/harness.mjs flag --help",
  "node skills/bin/harness.mjs flow report --help --json",
  "node skills/bin/harness.mjs judge merge -h",
  "node skills/bin/harness.mjs judge approve --help --json",
];

/** The gated pair's help: a read-only role may read it; the writer keeps it behind gated-help-exempt (above). */
const GATED_PAIR_HELP = [
  "node skills/bin/harness.mjs flag activate --help",
  "node skills/bin/harness.mjs outcome record -h --json",
];

const ordinaryFor = (
  roles: readonly string[],
  ...commands: string[]
): OrdinaryCase[] =>
  roles.flatMap((role) =>
    commands.map((input): OrdinaryCase => ({ role, tool: "Bash", input })),
  );

/** Every role's help at each level, and the read-only roles' help for the gated pair, all allowed with the flag off (#1802). */
export const HELP_LEVELS_ORDINARY: readonly OrdinaryCase[] = [
  ...ordinaryFor(ORDINARY_ROLES, ...HELP_LEVELS),
  ...ordinaryFor(READ_ONLY_HELP_ROLES, ...GATED_PAIR_HELP),
];

/** Help followed by a second command, or a pipe or redirect after it: refused for the read-only roles and the judge (#1802). */
const HELP_NEAR_MISSES = [
  "node skills/bin/harness.mjs --help flag activate",
  "node skills/bin/harness.mjs flow --help report",
  "node skills/bin/harness.mjs --help --json flow report",
  "node skills/bin/harness.mjs judge status --help 12",
  "node skills/bin/harness.mjs --help | tee help.txt",
  "node skills/bin/harness.mjs flag --help > help.txt",
  "node skills/bin/harness.mjs flag activate --help > help.txt",
  "node skills/bin/harness.mjs --help --json >> help.json",
];

export const HELP_NEAR_MISS_REFUSED: readonly CorpusCase[] = forRoles(
  READ_ONLY_HELP_ROLES,
  "role-read-only",
  ...HELP_NEAR_MISSES,
);

// The help-request corpus cases (#973, idea 0022): a writer asks the harness for help on a gated
// command. CORPUS in guard-corpus.ts refuses the requests while gated-help-exempt is off. With the
// flag on, HELP_ALLOWED must pass and HELP_STILL_REFUSED must stay refused; the integration spec
// (integration/hook/guard-corpus.spec.ts) runs both with the flag on.
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

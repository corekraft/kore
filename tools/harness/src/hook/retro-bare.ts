// Which segments of one Bash command post to GitHub or type into a pane without
// going through the harness: a bare `gh` comment, a comment API write, or a
// `herdr pane send-text` or `send-keys`. The harness's own commands name the
// harness, not gh or herdr, so they never match. A text match over the command,
// not a shell parser, the same heuristic the guard uses for its own segments.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

/** The bare sends a command makes: `gh` for a GitHub post, `herdr` for raw input typed into a pane. */
export type BareSend = "gh" | "herdr";

const SEPARATOR = /&&|\|\||[;|&\n]/;
const ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
const FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);

/** Whether a `gh api` segment writes: a comment path or an addComment mutation, with a method other than GET. */
function apiWrites(segment: string, tokens: readonly string[]): boolean {
  if (/\baddComment\b/.test(segment)) {
    return true;
  }
  if (!tokens.some((token) => token.includes("/comments"))) {
    return false;
  }
  const flag = tokens.findIndex(
    (token) => token === "-X" || token === "--method",
  );
  if (flag !== -1) {
    return (tokens[flag + 1] ?? "GET").toUpperCase() !== "GET";
  }
  return tokens.some((token) => FIELD_FLAGS.has(token));
}

/** The bare send one segment makes, or undefined when it makes none. */
function classify(segment: string): BareSend | undefined {
  const tokens = segment.trim().replace(ASSIGNMENT, "").split(/\s+/);
  const [program, first, second] = tokens;
  if (program === "gh") {
    if ((first === "issue" || first === "pr") && second === "comment") {
      return "gh";
    }
    return first === "api" && apiWrites(segment, tokens) ? "gh" : undefined;
  }
  if (
    program === "herdr" &&
    first === "pane" &&
    (second === "send-text" || second === "send-keys")
  ) {
    return "herdr";
  }
  return undefined;
}

/** One entry per bare send in the command, in order; empty when the command makes none. */
export function bareSends(command: string): BareSend[] {
  return command
    .split(SEPARATOR)
    .map(classify)
    .filter((send): send is BareSend => send !== undefined);
}

/** The role a bare send is counted under when the ledger holds no launch for the session's name. */
export const UNKNOWN_ROLE = "unknown";

/** One session's bare sends: its spawn-brief session name, or undefined for the main session, and the counts. */
export interface SessionSends {
  readonly sessionName: string | undefined;
  readonly bare: Readonly<Record<BareSend, number>>;
}

/** A role session's bare sends, with the role it was launched as. */
export interface BareCount {
  role: string;
  gh: number;
  herdr: number;
}

/** Bare sends per role session, rolled up per role. The main session names no spawn brief, so it is left out. */
export class BareTally {
  private readonly sessions = new Map<string, BareCount>();

  constructor(private readonly roles: Readonly<Record<string, string>>) {}

  add(id: string, { sessionName, bare }: SessionSends): void {
    if (sessionName === undefined || bare.gh + bare.herdr === 0) {
      return;
    }
    this.sessions.set(id, {
      role: this.roles[sessionName] ?? UNKNOWN_ROLE,
      gh: bare.gh,
      herdr: bare.herdr,
    });
  }

  /** Both lists sorted by name; empty when no role session made a bare send. */
  report(): {
    perSession: Record<string, BareCount>;
    perRole: Record<string, { sessions: number; gh: number; herdr: number }>;
  } {
    const perSession: Record<string, BareCount> = {};
    const perRole: Record<
      string,
      { sessions: number; gh: number; herdr: number }
    > = {};
    for (const [id, count] of this.sessions) {
      perSession[id] = count;
      const total = (perRole[count.role] ??= { sessions: 0, gh: 0, herdr: 0 });
      total.sessions++;
      total.gh += count.gh;
      total.herdr += count.herdr;
    }
    return { perSession: sorted(perSession), perRole: sorted(perRole) };
  }
}

const sorted = <T>(map: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
  );

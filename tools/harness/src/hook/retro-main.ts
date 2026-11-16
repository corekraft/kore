// What one Bash command shows of the main session's own figures (#940): a poll (a
// sleep, an until or seq loop, or a raw `gh pr checks`), a pane-result read, a signed
// send and a raw send. A text match over each command segment, the same heuristic
// retro-bare.ts uses, not a shell parser.

const SEPARATOR = /&&|\|\||[;|&\n]/;
const ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
const HARNESS = /^(?:.*\/)?harness(?:\.mjs|\.sh)?$/;
const PR_NUMBER = /^#?(\d+)$/;

/** The herdr subcommands that read a pane's output, and those that type into a pane. */
const READS = new Set(["agent read", "pane read"]);
const RAW = new Set(["agent prompt", "pane send-text", "pane send-keys"]);

export interface MainCommand {
  /** A sleep, an until loop or a seq loop: a poll whatever it waits on. */
  loop: boolean;
  /** Each pull request number a raw `gh pr checks` names, in order. */
  prChecks: string[];
  /** Pane-result reads: `herdr agent read` and `herdr pane read`. */
  reads: number;
  /** `harness session send`: a signed send, with its sender line. */
  signed: number;
  /** `herdr agent prompt`, `herdr pane send-text` and `herdr pane send-keys`. */
  raw: number;
}

const words = (segment: string): string[] =>
  segment.trim().replace(ASSIGNMENT, "").split(/\s+/);

/** Adds one command segment's figures to the command's. */
function classify(segment: string, into: MainCommand): void {
  const tokens = words(segment);
  const [program = ""] = tokens;
  if (
    program === "sleep" ||
    program === "until" ||
    (program === "for" && /\bseq\b/.test(segment))
  ) {
    into.loop = true;
  }
  tokens.forEach((token, i) => {
    const next = tokens[i + 1];
    const pair = `${next ?? ""} ${tokens[i + 2] ?? ""}`.trim();
    if (token === "gh" && next === "pr" && tokens[i + 2] === "checks") {
      const pr = PR_NUMBER.exec(tokens[i + 3] ?? "");
      if (pr) {
        into.prChecks.push(pr[1] ?? "");
      }
    } else if (token === "herdr") {
      into.reads += READS.has(pair) ? 1 : 0;
      into.raw += RAW.has(pair) ? 1 : 0;
    } else if (HARNESS.test(token) && next === "session") {
      into.signed += tokens[i + 2] === "send" ? 1 : 0;
    }
  });
}

/** The main session's figures one Bash command makes; all zero and no loop for a command that makes none. */
export function mainCommand(command: string): MainCommand {
  const found: MainCommand = {
    loop: false,
    prChecks: [],
    reads: 0,
    signed: 0,
    raw: 0,
  };
  for (const segment of command.split(SEPARATOR)) {
    classify(segment, found);
  }
  return found;
}

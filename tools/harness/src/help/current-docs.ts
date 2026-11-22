// The harness commands a current document names in code, read by the repository's document checks.

/** A harness command a document names in code: the words after `harness`, and the flags listed with it. */
export interface HarnessMention {
  /** The 1-based line the code sits on. */
  readonly line: number;
  /** The words after `harness`, at most two: the domain, then the command. */
  readonly words: readonly string[];
  /** The flags the mention lists, without their dashes. `--help` is a pointer to the help, so it is never listed. */
  readonly flags: readonly string[];
}

// A call is the bundle (`harness.mjs`, `harness.sh`, with any path before it), or a bare `harness` that
// starts a command. A path such as `tools/harness/`, a flag's value such as `--kind harness` and `--prefix
// tools/harness` are not calls.
const CALL =
  /(?<=^|[\s;&|(])(?:[\w./-]*\/)?harness\.(?:mjs|sh)(?=\s|$)|(?<=^\s*|[;&|(]\s*)harness(?=\s|$)/g;
const FENCE = /^\s*```/;
const CODE_SPAN = /`([^`]+)`/g;
const FLAG = /(?:^|\s|\[)--([a-z][\w-]*)/g;

/** The domain and command after a call: up to two lowercase words, the first two a call names. */
function wordsAfter(segment: string, from: number): string[] {
  const words: string[] = [];
  const word = /\s+([a-z][a-z0-9-]*)(?=\s|$)/y;
  word.lastIndex = from;
  for (
    let m = word.exec(segment);
    m !== null && words.length < 2;
    m = word.exec(segment)
  ) {
    words.push(m[1] ?? "");
  }
  return words;
}

/** Each call in one piece of code, with the flags that follow it up to the next call. */
function mentionsIn(code: string, line: number): HarnessMention[] {
  const calls = [...code.matchAll(CALL)];
  return calls.map((call, i) => {
    const start = call.index ?? 0;
    const end = calls[i + 1]?.index ?? code.length;
    const segment = code.slice(start, end);
    const from = call[0].length;
    const flags = [...segment.slice(from).matchAll(FLAG)]
      .map((m) => m[1] ?? "")
      .filter((flag) => flag !== "help");
    return { line, words: wordsAfter(segment, from), flags };
  });
}

/** The harness commands one document names in its code: each code span, and each line of a fenced block. */
export function harnessMentions(markdown: string): HarnessMention[] {
  const mentions: HarnessMention[] = [];
  let fenced = false;
  markdown.split("\n").forEach((text, index) => {
    if (FENCE.test(text)) {
      fenced = !fenced;
      return;
    }
    const codes = fenced
      ? [text]
      : [...text.matchAll(CODE_SPAN)].map((m) => m[1] ?? "");
    for (const code of codes) {
      mentions.push(...mentionsIn(code, index + 1));
    }
  });
  return mentions;
}

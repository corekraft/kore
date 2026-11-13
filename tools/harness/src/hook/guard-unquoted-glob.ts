// The `unquoted-glob` rule for --include/--exclude: zsh expands an unquoted glob
// and, when nothing matches, fails the whole command before it runs. Detection
// is the rule's original match. A corrected command is named only when it is
// certainly right to copy; otherwise the block gives the flag-only advice.
import { shellText } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

const GLOB_FLAG = /(^|\s)--(include|exclude)=([^\s'"]*\*[^\s'"]*)/g;

// The plain glob at the head of a matched value, when a separator or the end
// follows it. Only this head is quoted in a correction; the rest is kept as written.
const PLAIN_HEAD = /^([\w.*?/@+-]*\*[\w.*?/@+-]*)(?=$|[|&;<>])/;

// A corrected command longer than this is not printed in a block message.
const MAX_CORRECTED = 300;

interface Hit {
  lead: string;
  flag: string;
  value: string;
  index: number;
}

function hitsOf(text: string): Hit[] {
  return [...text.matchAll(GLOB_FLAG)].map((match) => ({
    lead: match[1] ?? "",
    flag: match[2] ?? "",
    value: match[3] ?? "",
    index: match.index,
  }));
}

// True when index sits inside a single- or double-quoted span.
function isQuoted(text: string, index: number): boolean {
  let quote = "";
  for (let i = 0; i < index; i += 1) {
    const char = text.charAt(i);
    if (quote === "'") {
      if (char === "'") {
        quote = "";
      }
    } else if (char === "\\") {
      i += 1;
    } else if (quote === '"') {
      if (char === '"') {
        quote = "";
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    }
  }
  return quote !== "";
}

export function unquotedGlob(command: string): Finding {
  // The checked text stops at a heredoc marker's line.
  const checked = shellText(command);
  const hits = hitsOf(checked);
  const first = hits[0];
  if (!first) {
    return null;
  }
  const glob = PLAIN_HEAD.exec(first.value)?.[1] ?? first.value;
  const unquoted = hits.filter(
    (hit) => !isQuoted(checked, hit.index + hit.lead.length),
  );
  const correctable =
    unquoted.length > 0 &&
    unquoted.every((hit) => PLAIN_HEAD.exec(hit.value) !== null) &&
    checked === command &&
    command.length <= MAX_CORRECTED;
  const reason = `--${first.flag}=${glob} is unquoted; zsh fails the whole command when the glob matches no file. `;
  if (correctable) {
    const corrected = checked.replace(
      GLOB_FLAG,
      (
        match: string,
        lead: string,
        name: string,
        text: string,
        offset: number,
      ) => {
        const head = PLAIN_HEAD.exec(text)?.[1];
        return head === undefined || isQuoted(checked, offset + lead.length)
          ? match
          : `${lead}--${name}='${head}'${text.slice(head.length)}`;
      },
    );
    return block("unquoted-glob", `${reason}Instead, run: ${corrected}`);
  }
  const advice = glob.includes("{")
    ? `Instead, write one quoted --${first.flag} per alternative of the brace list. No corrected command is offered.`
    : `Instead, quote it if it must stay literal: --${first.flag}='${glob}'. No corrected command is offered.`;
  return block("unquoted-glob", `${reason}${advice}`);
}

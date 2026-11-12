// Shell parsing for the guard: split a command into segments of words, find the
// command each segment runs, and scan raw words for zsh pitfalls.
import { basename } from "node:path";

const OPERATORS = new Set([";", "&&", "||", "|", "&", "\n"]);

/** Accumulates the words and segments of one command as it is scanned. */
class Splitter {
  readonly segments: string[][] = [];
  private tokens: string[] = [];
  private word = "";
  private inWord = false;
  private quote: string | null = null;

  constructor(private readonly command: string) {}

  run(): string[][] {
    for (let i = 0; i < this.command.length; i++) {
      i = this.step(i);
    }
    this.endSegment();
    return this.segments;
  }

  private endWord(): void {
    if (this.inWord) {
      this.tokens.push(this.word);
    }
    this.word = "";
    this.inWord = false;
  }

  private endSegment(): void {
    this.endWord();
    if (this.tokens.length > 0) {
      this.segments.push(this.tokens);
    }
    this.tokens = [];
  }

  private append(char: string): void {
    this.word += char;
    this.inWord = true;
  }

  /** Handles the character at `i`; returns the index of the last one consumed. */
  private step(i: number): number {
    const char = this.command[i] as string;
    const next = this.command[i + 1];
    if (this.quote) {
      return this.quoted(i, char);
    }
    if (char === "'" || char === '"') {
      this.quote = char;
      this.inWord = true;
    } else if (char === "\\" && next !== undefined) {
      this.append(next);
      return i + 1;
    } else if (char === " " || char === "\t") {
      this.endWord();
    } else if (char === "\n" || char === ";") {
      this.endSegment();
    } else if ((char === "&" || char === "|") && next === char) {
      this.endSegment();
      return i + 1;
    } else if (this.isSingleOperator(i, char)) {
      this.endSegment();
    } else {
      this.append(char);
    }
    return i;
  }

  private isSingleOperator(i: number, char: string): boolean {
    return (
      char === "|" ||
      (char === "&" &&
        this.command[i + 1] !== ">" &&
        this.command[i - 1] !== ">")
    );
  }

  private quoted(i: number, char: string): number {
    if (char === this.quote) {
      this.quote = null;
    } else if (
      char === "\\" &&
      this.quote === '"' &&
      i + 1 < this.command.length
    ) {
      this.word += this.command[i + 1];
      return i + 1;
    } else {
      this.word += char;
    }
    return i;
  }
}

/** Split a shell command into segments of unquoted-word tokens. */
export function splitSegments(command: string): string[][] {
  return new Splitter(command)
    .run()
    .filter(
      (segment) =>
        !(segment.length === 1 && OPERATORS.has(segment[0] as string)),
    );
}

const WRAPPERS = new Set(["sudo", "env", "time", "command", "nohup", "exec"]);

/** Return the command name and its arguments, skipping env assignments and wrappers. */
export function commandOf(tokens: readonly string[]): {
  name: string;
  args: string[];
} {
  let index = 0;
  while (
    index < tokens.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] as string) ||
      WRAPPERS.has(tokens[index] as string))
  ) {
    index++;
  }
  if (index >= tokens.length) {
    return { name: "", args: [] };
  }
  return {
    name: basename(tokens[index] as string),
    args: tokens.slice(index + 1),
  };
}

export const isKore = (name: string, args: readonly string[]): boolean =>
  name === "kore" ||
  (name === "npm" && args.includes("kore")) ||
  (name === "node" && args.some((arg) => arg.endsWith("cli/cli.js")));

export const hasFlag = (args: readonly string[], flag: string): boolean =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

export const firstPositional = (args: readonly string[]): string | undefined =>
  args.find((arg) => !arg.startsWith("-"));

// Heredoc bodies are data, not shell words: scan only up to the line that
// opens the first heredoc.
export function shellText(command: string): string {
  const start = command.indexOf("<<");
  if (start < 0) {
    return command;
  }
  const newline = command.indexOf("\n", start);
  return newline < 0 ? command : command.slice(0, newline);
}

const WORD_BREAK = new Set([
  " ",
  "\t",
  "\n",
  ";",
  "&",
  "|",
  "(",
  ")",
  "<",
  ">",
]);

// $?, $*, $#, $@ and the other special parameters expand before globbing.
const SPECIAL_PARAMETER = /^[?*#@!$0-9-]$/;

export interface RawWord {
  text: string;
  glob: boolean;
  equals: boolean;
}

/** Collects raw words, tracking quotes, as a command is scanned. */
class WordScanner {
  readonly words: RawWord[] = [];
  private word: RawWord | null = null;
  private quote: string | null = null;

  constructor(private readonly command: string) {}

  run(): RawWord[] {
    for (let i = 0; i < this.command.length; i++) {
      i = this.step(i);
    }
    this.end();
    return this.words;
  }

  private start(): RawWord {
    return (this.word ??= { text: "", glob: false, equals: false });
  }

  private end(): void {
    if (this.word) {
      this.words.push(this.word);
    }
    this.word = null;
  }

  /** Handles the character at `i`; returns the index of the last one consumed. */
  private step(i: number): number {
    const char = this.command[i] as string;
    const next = this.command[i + 1];
    if (this.quote) {
      return this.inQuote(i, char);
    }
    if (char === "'" || char === '"') {
      this.start();
      this.quote = char;
    } else if (char === "\\") {
      this.start().text += next ?? "";
      return i + 1;
    } else if (WORD_BREAK.has(char)) {
      this.end();
    } else if (char === "$" && SPECIAL_PARAMETER.test(next ?? "")) {
      this.start().text += char + (next ?? "");
      return i + 1;
    } else {
      this.plain(char, next);
    }
    return i;
  }

  private inQuote(i: number, char: string): number {
    if (char === this.quote) {
      this.quote = null;
    } else if (char === "\\" && this.quote === '"') {
      this.start().text += this.command[i + 1] ?? "";
      return i + 1;
    } else {
      this.start().text += char;
    }
    return i;
  }

  private plain(char: string, next: string | undefined): void {
    const current = this.start();
    if (char === "*" || char === "?") {
      current.glob = true;
    }
    if (char === "=" && current.text === "" && /[^\s]/.test(next ?? " ")) {
      current.equals = true;
    }
    current.text += char;
  }
}

/** Raw shell words, noting an unquoted * or ? and an unquoted leading =. */
export function rawWords(command: string): RawWord[] {
  return new WordScanner(command).run();
}

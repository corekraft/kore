const ESC = String.fromCharCode(27);
const CSI = `${ESC}[`;

/** One run of the text: its characters, then the style parameters of the escape that follows it, if it was an SGR one. */
interface Run {
  text: string;
  params: string | undefined;
}

/** Whether the character is a CSI parameter byte (0-9 : ; < = > ?) or intermediate byte (space to /). */
function inside(char: string): boolean {
  return char >= " " && char <= "?";
}

/**
 * Splits the text at every CSI escape (ESC [ parameters intermediates final byte), not only colour and style:
 * cursor moves and erases are dropped too, so none can hide a prompt mark. Only a plain `m` escape of digits
 * and semicolons carries style parameters. An escape that never ends stays in the text, and plain() drops its ESC.
 */
function runs(text: string): Run[] {
  const found: Run[] = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf(CSI, at);
    let end = start + CSI.length;
    while (start >= 0 && end < text.length && inside(text.charAt(end))) {
      end += 1;
    }
    const final = text.charAt(end);
    if (start < 0 || end >= text.length || final < "@" || final > "~") {
      found.push({ text: text.slice(at), params: undefined });
      return found;
    }
    const params = text.slice(start + CSI.length, end);
    found.push({
      text: text.slice(at, start),
      params: final === "m" && /^[\d;]*$/.test(params) ? params : undefined,
    });
    at = end + 1;
  }
}

/** Drops any ESC left over from an escape that was not complete. */
function withoutEsc(text: string): string {
  return text.split(ESC).join("");
}

/** True when the line holds an ESC that no complete CSI escape accounts for, so it cannot be read reliably. */
export function garbled(line: string): boolean {
  return runs(line).some((run) => run.text.includes(ESC));
}

/** The text with every CSI escape removed. */
export function plain(text: string): string {
  return withoutEsc(
    runs(text)
      .map((run) => run.text)
      .join(""),
  );
}

/** Whether the parameters switch faint on (`on`), or off (`off`), or neither (undefined). */
function faint(params: string): boolean | undefined {
  const codes = params === "" ? ["0"] : params.split(";");
  let state: boolean | undefined;
  for (let i = 0; i < codes.length; i++) {
    const code = Number(codes[i]);
    if (code === 38 || code === 48) {
      // Skip the colour's own arguments: 5;n or 2;r;g;b.
      i += codes[i + 1] === "5" ? 2 : 4;
    } else if (code === 2) {
      state = true;
    } else if (code === 0 || code === 22) {
      state = false;
    }
  }
  return state;
}

/**
 * The line without escapes and without the characters drawn faint (SGR 2).
 * Claude Code draws its suggested prompt faint; text a person typed is not.
 */
export function withoutDim(line: string): string {
  let dim = false;
  let kept = "";
  for (const run of runs(line)) {
    if (!dim) {
      kept += run.text;
    }
    dim = run.params === undefined ? dim : (faint(run.params) ?? dim);
  }
  return withoutEsc(kept);
}

// Matches SGR (colour and style) sequences, the only escapes herdr's --ansi read emits.
const CSI = `${String.fromCharCode(27)}[`;

/** One run of the text: its characters, then the style parameters (SGR) that follow it, if any. */
interface Run {
  text: string;
  params: string | undefined;
}

/** Splits the text at its SGR sequences (colour and style, the only escapes herdr's --ansi read emits). */
function runs(text: string): Run[] {
  const found: Run[] = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf(CSI, at);
    const end = start < 0 ? -1 : text.indexOf("m", start);
    const params = end < 0 ? "" : text.slice(start + CSI.length, end);
    if (end < 0 || !/^[\d;]*$/.test(params)) {
      found.push({ text: text.slice(at), params: undefined });
      return found;
    }
    found.push({ text: text.slice(at, start), params });
    at = end + 1;
  }
}

/** The text with every colour and style escape removed. */
export function plain(text: string): string {
  return runs(text)
    .map((run) => run.text)
    .join("");
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
  return kept;
}

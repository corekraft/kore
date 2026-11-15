// Matches SGR (colour and style) sequences, the only escapes herdr's --ansi read emits.
const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([\\d;]*)m`, "g");

/** The text with every colour and style escape removed. */
export function plain(text: string): string {
  return text.replace(SGR, "");
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
  let at = 0;
  for (const match of line.matchAll(SGR)) {
    if (!dim) {
      kept += line.slice(at, match.index);
    }
    at = match.index + match[0].length;
    dim = faint(match[1] ?? "") ?? dim;
  }
  return dim ? kept : kept + line.slice(at);
}

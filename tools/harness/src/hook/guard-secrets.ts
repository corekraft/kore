// Secret material and encrypted paths: blocking rules shared by the Bash and
// file checks.
import { block, type GuardContext, type Hit } from "./guard-verdict.js";

export const SECRET_PATH =
  /(^|[/\s>'"=])\.kore\/(keys\/|state\/[^/\s'"]*token)/;
export const SECRET_SAFE = new Set(["ls", "stat", "test", "["]);

export const secretBlock = (): Hit =>
  block(
    "secret-path",
    "Key and token material under .kore/ must not be read or written directly. " +
      "Instead, use a kore command that streams the secret through stdin, or ask the user to handle it.",
  );

export async function loadSopsPatterns(ctx: GuardContext): Promise<RegExp[]> {
  let text: string;
  try {
    text = await ctx.readFile(`${ctx.root}/.sops.yaml`);
  } catch {
    return [];
  }
  const patterns: RegExp[] = [];
  for (const match of text.matchAll(/path_regex:\s*(.+)$/gm)) {
    const source = (match[1] as string).trim().replace(/^['"]|['"]$/g, "");
    try {
      // nosemgrep: kore-dynamic-regexp -- path_regex comes from the committed .sops.yaml, not external input
      patterns.push(new RegExp(source));
    } catch {
      // An unparsable pattern cannot be checked; skip it rather than block work.
    }
  }
  return patterns;
}

export const sopsBlock = (path: string): Hit =>
  block(
    "sops-plaintext",
    `${path} is an encrypted secret path; plaintext must never be written to it. ` +
      "Instead, edit it with `sops <path>` or encrypt through `sops --encrypt`.",
  );

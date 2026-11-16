// What the guard reads from the hook's own environment: the home a leading ~ expands to, and
// whether the host's Bash tool is verified to run bash, which the three zsh rules (unquoted-glob,
// equals-word, bare-glob) need before they skip.
//
// The only source of the shell is the hook process's environment, which the host sets from the
// owner's user settings: CLAUDE_CODE_SHELL first, then SHELL. The hook payload carries no shell
// field, and a recorded check or any file an agent can write is never read, since it can go stale
// or be forged. Anything else is not verified, so the rules keep guarding (fail closed).
import { homedir } from "node:os";

type Env = Readonly<Record<string, string | undefined>>;

const BASH_NAME = /(^|\/)bash$/;

/** True only when the first non-empty of CLAUDE_CODE_SHELL and SHELL names the bash executable. */
export function verifiedBash(env: Env): boolean {
  const shell = env["CLAUDE_CODE_SHELL"] || env["SHELL"];
  return shell !== undefined && BASH_NAME.test(shell);
}

/** The home directory and the verified shell, as the guard's rules read them. */
export function hostFacts(env: Env): { home: string; verifiedBash: boolean } {
  return { home: env["HOME"] || homedir(), verifiedBash: verifiedBash(env) };
}

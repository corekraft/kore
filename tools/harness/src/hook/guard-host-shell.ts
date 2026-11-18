// What the guard reads from the hook's own environment: the home a leading ~ expands to, and
// whether the host's Bash tool is verified to run bash, which the three zsh rules (unquoted-glob,
// equals-word, bare-glob) need before they skip.
//
// The shell comes only from the hook process's environment, which the host sets from the owner's
// user settings: CLAUDE_CODE_SHELL first, then SHELL. The hook payload carries no shell field, and
// a recorded check or any file an agent can write is never read, since it can go stale or be
// forged. The skip is also behind the shell-aware-zsh-rules flag, read from the local overlay and
// off until the owner activates it, so with the flag off every verdict is as before. Anything that
// is not a clear yes is not verified, so the rules keep guarding (fail closed).
import { homedir } from "node:os";
import { localFlagOn } from "./guard-local-flag.js";
import type { FileSystem } from "../runtime/index.js";

// The help exemption (#973) is read from the same local overlay, so the guard's flag reads sit in one place.
export { helpExemptOn } from "./guard-help.js";

type Env = Readonly<Record<string, string | undefined>>;

/** The flag that lets the three zsh rules skip under a verified bash; off in every overlay. */
export const SHELL_AWARE_FLAG = "shell-aware-zsh-rules";
const BASH_NAME = /(^|\/)bash$/;

/** True only when the first non-empty of CLAUDE_CODE_SHELL and SHELL names the bash executable. */
export function verifiedBash(env: Env): boolean {
  const shell = env["CLAUDE_CODE_SHELL"] || env["SHELL"];
  return shell !== undefined && BASH_NAME.test(shell);
}

/** Whether the local overlay turns the shell-aware flag on; off on any failure, as localFlagOn reads it. */
const flagOn = (fs: FileSystem, root: string): Promise<boolean> =>
  localFlagOn(fs, root, SHELL_AWARE_FLAG);

/** The home directory and the verified shell, as the guard's rules read them. */
export async function hostFacts(
  env: Env,
  fs: FileSystem,
  root: string,
): Promise<{ home: string; verifiedBash: boolean }> {
  return {
    home: env["HOME"] || homedir(),
    // The overlay is read only once the shell names bash, so every other call pays nothing.
    verifiedBash: verifiedBash(env) && (await flagOn(fs, root)),
  };
}

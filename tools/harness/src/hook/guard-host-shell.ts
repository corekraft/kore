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
import { platformDomainOf } from "./guard-leak.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import { sessionIdentity, sessionNotice } from "./guard-identity.js";

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

/** The platform domain fact: present only when the run-time variable names one. */
const domainFact = (env: Env): { platformDomain?: string } => {
  const platformDomain = platformDomainOf(env);
  return platformDomain === undefined ? {} : { platformDomain };
};

/** The home directory, the verified shell and the run-time platform domain, as the guard's rules read them. */
export async function hostFacts(
  env: Env,
  fs: FileSystem,
  root: string,
): Promise<{ home: string; verifiedBash: boolean; platformDomain?: string }> {
  return {
    home: env["HOME"] || homedir(),
    // The overlay is read only once the shell names bash, so every other call pays nothing.
    verifiedBash: verifiedBash(env) && (await flagOn(fs, root)),
    // The platform domain the run-time variable names, for the leak rule (ADR 0164); absent when unset.
    ...domainFact(env),
  };
}

/** The role the session record of the hc terminal this hook runs in names; empty outside one, or when no record names it. */
export async function terminalRoleFacts(
  deps: CliDeps,
): Promise<{ role?: string }> {
  const identity = await sessionIdentity(deps);
  return identity === undefined ? {} : { role: identity.role };
}

/** The notice for the hc terminal this hook runs in when its own session record cannot be read: a leading newline, then the notice; empty when there is none. */
export async function terminalNotice(deps: CliDeps): Promise<string> {
  const notice = await sessionNotice(deps);
  return notice === undefined ? "" : `\n${notice}`;
}

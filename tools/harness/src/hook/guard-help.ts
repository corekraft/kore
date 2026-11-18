// The help exemption for a gated harness command (#973, idea 0022). With gated-help-exempt on in the
// local overlay, a writer may ask the bundle for help on `flag activate` or `outcome record`: the
// bundle, the gated pair, then exactly one --help or -h (bundleHelpRequest, guard-role-writes.ts). The
// read-only roles already take this shape (harnessHelp, guard-role-allow.ts). It adds no rule: it lets
// one refused shape through, behind the flag.
import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./guard-local-flag.js";

export const HELP_EXEMPT_FLAG = "gated-help-exempt";
const HELP_WORD = /(?:^|\s)(?:--help|-h)(?:\s|$)/;

/** Whether a Bash command's text carries --help or -h as a word; only such a call reads the flag. */
export const namesHelpFlag = (command: unknown): boolean =>
  typeof command === "string" && HELP_WORD.test(command);

/** The fields of a call the exemption reads: its tool and, for Bash, its command. */
interface HelpCall {
  tool_name?: unknown;
  tool_input?: Record<string, unknown>;
}

/**
 * Whether this call may ask for help: a Bash call whose text carries a help flag, and only while the
 * local overlay turns gated-help-exempt on. Every other call reads no overlay.
 */
export async function helpExemptOn(
  fs: FileSystem,
  root: string,
  call: HelpCall,
): Promise<boolean> {
  return (
    call.tool_name === "Bash" &&
    namesHelpFlag(call.tool_input?.["command"]) &&
    (await localFlagOn(fs, root, HELP_EXEMPT_FLAG))
  );
}

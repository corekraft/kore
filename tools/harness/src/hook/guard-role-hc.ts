// Raw hc writes by the writer (plan 16, Step 4). The writer has a full shell, so a raw hc send types into
// another terminal, and a raw hc label, hc run or hc exec, or an HC_TERMINAL_ID prefix, can relabel or drive
// one, and a label is what names a role. The rule starts in audit mode (ADR 0080): it warns until the owner
// activates it. Only the writer is checked here, and it is identified by its session record, which exists only
// in an hc terminal, so a process outside one is not checked here. The read-only roles and the judge are refused by their
// allowlist (role-read-only), not here.
import { commandOf } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

/** The hc verbs that write to a terminal. */
const RAW_VERBS = new Set(["send", "label", "run", "exec"]);

/** A raw hc write. Any word may be the verb, so a flag's value cannot hide one (`hc --json send`). */
const rawHc = (segment: readonly string[]): boolean => {
  const { name, args } = commandOf(segment);
  return name === "hc" && args.some((arg) => RAW_VERBS.has(arg));
};

/** A segment that sets HC_TERMINAL_ID, for the command it runs or alone. */
const setsHcTerminal = (segment: readonly string[]): boolean => {
  const { name, args } = commandOf(segment);
  const lead = name === "" ? segment.length : segment.length - args.length - 1;
  return segment
    .slice(0, lead)
    .some((word) => word.startsWith("HC_TERMINAL_ID="));
};

/** The writer's finding for one segment of its shell: null when the segment writes no terminal, or the caller is not the writer. */
export function checkHcWrite(
  segment: readonly string[],
  role: string | undefined,
): Finding {
  if (role !== "writer" || !(rawHc(segment) || setsHcTerminal(segment))) {
    return null;
  }
  return block(
    "role-hc-raw",
    "`" +
      segment.join(" ") +
      "` drives or relabels a terminal by hand: a raw hc send, label, run or exec, or an HC_TERMINAL_ID prefix, can type into or relabel a terminal, and a label is what names a role. " +
      "Instead, message a session with `node skills/bin/harness.mjs session send <name> --message <text>`, or report with `node skills/bin/harness.mjs session report`.",
  );
}

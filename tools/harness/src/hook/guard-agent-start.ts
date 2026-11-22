// Agent-start rule: a bare `herdr agent start` launches a session outside `harness session
// spawn`, so the role guards, the writer host-lease refusal and the role tokens (#364) never
// apply to it. Enforced from the start: the owner approved this on #408 (2026-11-12), the
// approval ADR 0080 requires for a guardrail that blocks. The hc form of the same launch (an
// `hc run` of claude) is its own rule, `bare-agent-start-hc`, in audit mode: the owner's
// approval covered herdr only, so the hc form warns until the owner activates it (plan 16, Step 4).
import { block, type Finding } from "./guard-verdict.js";

const HC_MESSAGE =
  "hc run starts a claude session without the role guards, the writer host-lease refusal or the role tokens, which only harness session spawn applies. " +
  'Instead, launch the session with `harness session spawn --role <role> --name <name> --brief "<brief>"`.';

/** A word names claude when its last path part is claude: `claude` or `/usr/local/bin/claude`. */
const namesClaude = (word: string): boolean =>
  word.split("/").pop() === "claude";

/** An argument names claude as a word, or as a word of a script it passes to a shell (`sh -c "exec claude"`). */
const claudeArgument = (arg: string): boolean =>
  arg.split(/[\s;&|()<>"'`]+/).some(namesClaude);

/** The verb `run` among hc's words before the `--` that ends its options, wherever it stands (`hc --json run`). */
const hcRunVerb = (args: string[]): boolean => {
  const end = args.indexOf("--");
  return (end === -1 ? args : args.slice(0, end)).includes("run");
};

export function checkAgentStart(name: string, args: string[]): Finding {
  if (name === "hc") {
    return hcRunVerb(args) && args.some(claudeArgument)
      ? block("bare-agent-start-hc", HC_MESSAGE)
      : null;
  }
  if (name !== "herdr" || args[0] !== "agent" || args[1] !== "start") {
    return null;
  }
  // A help request as the first argument launches nothing, so it passes. Help anywhere
  // else sits beside a launch's flags, so it does not.
  if (args[2] === "--help" || args[2] === "-h") {
    return null;
  }
  return block(
    "bare-agent-start",
    "herdr agent start launches a session without the role guards, the writer host-lease refusal or the role tokens, which only harness session spawn applies. " +
      'Instead, launch the session with `harness session spawn --role <role> --name <name> --brief "<brief>"`.',
  );
}

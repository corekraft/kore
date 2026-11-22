// Agent-start rule: a bare `herdr agent start` launches a session outside `harness session
// spawn`, so the role guards, the writer host-lease refusal and the role tokens (#364) never
// apply to it. Enforced from the start: the owner approved this on #408 (2026-11-12), the
// approval ADR 0080 requires for a guardrail that blocks. An `hc run` that starts claude is the same
// launch in hc's form (plan 16, Step 4).
import { block, type Finding } from "./guard-verdict.js";

const HC_MESSAGE =
  "hc run starts a claude session without the role guards, the writer host-lease refusal or the role tokens, which only harness session spawn applies. " +
  'Instead, launch the session with `harness session spawn --role <role> --name <name> --brief "<brief>"`.';

export function checkAgentStart(name: string, args: string[]): Finding {
  if (name === "hc") {
    return args[0] === "run" && args.includes("claude")
      ? block("bare-agent-start", HC_MESSAGE)
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

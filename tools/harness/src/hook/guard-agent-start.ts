// Agent-start rule: a bare `herdr agent start` launches a session outside `harness session
// spawn`, so the role guards, the writer host-lease refusal and the role tokens (#364) never
// apply to it. Enforced from the start: the owner approved this on #408 (2026-11-12), the
// approval ADR 0080 requires for a guardrail that blocks.
import { block, type Finding } from "./guard-verdict.js";

export function checkAgentStart(name: string, args: string[]): Finding {
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

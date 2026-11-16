// Role bounds for the delivery loop's read-only agents (ADR 0078). Panes run in
// bypass mode, so these guard rules, not permission prompts, keep the
// reader from writing files. The delivery roles are bounded in guard-role-delivery.ts. The host names the role as `agent_type` when a session starts with
// `claude --agent <role>`; a session without one is not bounded here.
//
// These rules enforce from the start, not in audit mode: the owner approved
// enforcing the plan 11 role guards on 2026-11-12, which ADR 0080 requires a
// person to do. A new capability for a role needs a guard case first.
import { readMayRun } from "./guard-role-allow.js";
import { checkDelivery } from "./guard-role-delivery.js";
import {
  DELIVERY_ROLES,
  READ_ONLY_ROLES,
  REPORTING_ROLES,
  SPAWNED_ROLES,
} from "./guard-roles.js";
import { checkProtected } from "./guard-role-protected.js";
import {
  notifiesFinish,
  notRead,
  readOnly,
  sendsToPane,
  setsEnvironment,
  useNotify,
  writes,
  WRITE_TOOLS,
} from "./guard-role-writes.js";
import { splitSegments } from "./guard-shell.js";
import { type Finding } from "./guard-verdict.js";

const READ_ONLY_ROLE_SET = new Set<string>(READ_ONLY_ROLES);
const SPAWNED_ROLE_SET = new Set<string>(SPAWNED_ROLES);

/** The harness commands the read-only roles may run; each is read-only. */
const HARNESS_READS = [
  "plan active",
  "idea list",
  "idea show",
  "flow report",
  "ledger list",
];

const finishes = (role: string, segment: readonly string[]): boolean =>
  SPAWNED_ROLE_SET.has(role) && notifiesFinish(segment);

function checkBash(role: string, command: string): Finding {
  // A substitution runs a command the segment check never sees.
  if (/\$\(|`|<\(|>\(/.test(command)) {
    return notRead("A command substitution");
  }
  const segments = splitSegments(command);
  const prefixed = segments.find(setsEnvironment);
  if (prefixed !== undefined) {
    const what = `\`${prefixed.join(" ")}\`, which sets an environment variable or changes shell state,`;
    return notRead(what);
  }
  // Only a role a brief asks for the notice is pointed at it.
  const typing = SPAWNED_ROLE_SET.has(role)
    ? segments.find(sendsToPane)
    : undefined;
  if (typing !== undefined) {
    return useNotify(`\`${typing.join(" ")}\``);
  }
  const writer = segments.find(writes);
  if (writer !== undefined) {
    return readOnly(`\`${writer.join(" ")}\``);
  }
  const unknown = segments.find(
    (segment) =>
      !finishes(role, segment) && !readMayRun(segment, HARNESS_READS),
  );
  return unknown === undefined
    ? null
    : notRead(
        `\`${unknown.join(" ")}\`, which is not a known read-only command,`,
      );
}

/** The role bounds for one tool call; null when the session has no bounded role or the call is within it. */
export function checkRole(
  agentType: unknown,
  tool: string,
  input: Record<string, unknown>,
  root: string,
  cwd: string = root,
): Finding {
  const bound =
    typeof agentType === "string" &&
    (DELIVERY_ROLES.has(agentType) || READ_ONLY_ROLE_SET.has(agentType));
  const protectedFinding = bound
    ? checkProtected(agentType, tool, input, root)
    : null;
  if (protectedFinding !== null) {
    return protectedFinding;
  }
  if (typeof agentType === "string" && DELIVERY_ROLES.has(agentType)) {
    return checkDelivery(
      agentType,
      REPORTING_ROLES.includes(agentType),
      tool,
      input,
      { root, cwd },
    );
  }
  if (typeof agentType !== "string" || !READ_ONLY_ROLE_SET.has(agentType)) {
    return null;
  }
  if (WRITE_TOOLS.has(tool)) {
    return readOnly(`${tool}`);
  }
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkBash(agentType, input["command"]);
  }
  return null;
}

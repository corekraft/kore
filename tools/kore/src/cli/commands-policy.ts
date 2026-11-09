import { readFile } from "node:fs/promises";
import {
  promoteConstraint,
  recordPromotionEvidence,
  rollbackConstraint,
} from "../config/index.js";
import type { CommandContext } from "./context.js";
import { requireEnvironment, stringFlag } from "./flags.js";
import { print } from "./output.js";

const ACTIONS = ["record", "promote", "rollback"];

function parseAudit(text: string, source: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `policy record: --audit ${source} is not JSON; use kubectl get --output json`,
      );
    }
    throw error;
  }
}

/**
 * Edits Gatekeeper constraints in the repository (desired state), never the
 * cluster: `kore platform up` applies the change. `--environment` is required
 * because the promotion evidence belongs to one environment.
 */
export async function policyCommand(context: CommandContext): Promise<number> {
  const action = context.action ?? "";
  if (!ACTIONS.includes(action)) {
    throw new Error(
      `unknown policy action "${action}"; use record, promote, or rollback`,
    );
  }
  requireEnvironment(context.parsed);
  const name = context.parsed.positional[0];
  if (name === undefined) {
    throw new Error(
      `policy ${action} needs the constraint name, for example kore-workload-identity`,
    );
  }
  const { repository } = context;
  if (action === "record") {
    const source = stringFlag(context.parsed, "audit");
    if (source === undefined) {
      throw new Error(
        `policy record needs --audit <file> (or - for stdin): the output of kubectl --context <context> get <kind>.constraints.gatekeeper.sh ${name} --output json`,
      );
    }
    const text = await readFile(source === "-" ? "/dev/stdin" : source, "utf8");
    const audit = parseAudit(text, source);
    const record = await recordPromotionEvidence(repository, name, audit);
    print(
      {
        constraint: name,
        environment: repository.environment.name,
        ...record.environments[repository.environment.name],
      },
      context.json,
    );
    return 0;
  }
  const change =
    action === "promote"
      ? await promoteConstraint(repository, name)
      : await rollbackConstraint(repository, name);
  print(change, context.json);
  return 0;
}

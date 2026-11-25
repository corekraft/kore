// The vps-limited flag audit (`harness flag audit --vps`). Every true vps flag
// needs a live-run outcome, never an owner waiver (ADR 0147). Its mode is the
// vps-flag-proof guardrail's: audit warns and exits zero, enforce fails (ADR 0080).
// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

import {
  FlagError,
  VPS_ENVIRONMENT,
  vpsLine,
  vpsUnprovenFlags,
} from "../flag/index.js";
import { GuardrailError, modeOf, readInventory } from "../guardrail/index.js";
import type { CommandContext } from "../runtime/index.js";

const FAILED = 1;

/** The guardrail rule that decides whether the vps audit fails. */
export const VPS_PROOF_RULE = "vps-flag-proof";

/** Runs the vps audit against the repository root `base`. */
export async function auditVps(
  context: CommandContext,
  base: string,
): Promise<number> {
  const { deps, json } = context;
  const inventory = await readInventory(
    (path) => deps.fs.readFile(path),
    base,
  ).catch((cause: unknown) => {
    if (cause instanceof GuardrailError) {
      throw new FlagError(cause.message);
    }
    throw cause;
  });
  const mode = modeOf(inventory, VPS_PROOF_RULE);
  const unproven = await vpsUnprovenFlags(deps.fs, deps.clock, base);
  const body = `${JSON.stringify({ environment: VPS_ENVIRONMENT, mode, unproven })}\n`;
  if (unproven.length === 0) {
    deps.stdout(
      json
        ? body
        : "Flag audit (vps) passed: every flag that is on in vps has a live-run outcome.\n",
    );
    return 0;
  }
  if (mode === "audit") {
    if (json) {
      deps.stdout(body);
    } else {
      deps.stderr(unproven.map((u) => `warning: ${vpsLine(u)}\n`).join(""));
    }
    return 0;
  }
  deps.stderr(json ? body : unproven.map((u) => `${vpsLine(u)}\n`).join(""));
  return FAILED;
}

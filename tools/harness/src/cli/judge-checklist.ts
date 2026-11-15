import { GuardrailError, readInventory } from "../guardrail/index.js";
import {
  JudgeError,
  modesFrom,
  type ItemModes,
  type Report,
} from "../judge/index.js";
import { bundleMainRoot, type CommandContext } from "../runtime/index.js";
import { openJudgeLedger } from "./judge-shared.js";

/**
 * Each checklist item's mode, from the inventory of the main checkout that holds this
 * bundle. The judge may not choose it: an unreadable inventory is refused, never read as
 * every item enforcing.
 */
export async function checklistModes({
  deps,
}: CommandContext): Promise<ItemModes> {
  const main = await bundleMainRoot(deps);
  if (main === undefined) {
    throw new JudgeError(
      "Cannot find the main checkout from the harness bundle's location, so there is no guardrail inventory to read checklist modes from. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository.",
    );
  }
  try {
    return modesFrom(await readInventory(deps.fs.readFile, main));
  } catch (error) {
    if (error instanceof GuardrailError) {
      throw new JudgeError(
        `${error.message} The judge reads each checklist item's mode from the inventory; fix it, then rerun.`,
      );
    }
    throw error;
  }
}

/**
 * Writes one guard.audit ledger event for each audit item that failed, through the
 * ledger. A firing is an item at a head: a rerun at the same head writes nothing more.
 */
export async function recordAudits(
  context: CommandContext,
  report: Report,
): Promise<void> {
  const failing = report.audited ?? [];
  if (failing.length === 0 || report.head === undefined) {
    return;
  }
  const ledger = await openJudgeLedger(context);
  const logged = new Set(
    (await ledger.list({ kind: "guard.audit" })).events.map((e) => e.id),
  );
  const idea = report.idea;
  for (const { rule } of failing) {
    const id = `judge.audit:${report.pr}:${report.head}:${rule}`;
    if (logged.has(id)) {
      continue;
    }
    const event = await ledger.record({
      source: "github",
      kind: "guard.audit",
      occurredAt: context.deps.clock.now().toISOString(),
      label: rule,
      id,
      ...(idea !== undefined && /^[\w.:/#@-]{1,128}$/.test(idea)
        ? { idea }
        : {}),
    });
    if (!event.ok) {
      throw new JudgeError(
        `The precheck ran, but the ledger event for audit item ${rule} was rejected: ${event.message} Fix the ledger, then rerun \`harness judge precheck ${report.pr}\`.`,
      );
    }
  }
}

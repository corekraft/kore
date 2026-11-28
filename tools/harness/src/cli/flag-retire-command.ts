// The `flag retire` command: removes a feature flag that has soaked on in every environment it applies to, and only one (ADR 0149). Split helpers live beside it so each module stays under the lint cap.

import {
  FlagError,
  parseManifest,
  readManifestText,
  remainingReferences,
  retireRefusals,
  type Reference,
} from "../flag/index.js";
import { parseEvent } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { retireEdits, type RetireEdits } from "./flag-retire-edits.js";
import { retireFactsOf } from "./flag-retire-facts.js";
import { retireHelp } from "./flag-retire-help.js";
import { guarded, releaseLock, root } from "./flag-command-helpers.js";
import { openLedger } from "./ledger-commands.js";

function retireTarget(context: CommandContext): string {
  const flag = context.operand;
  if (flag === undefined) {
    throw new FlagError("Missing flag name; run `harness flag retire <flag>`.");
  }
  return flag;
}

/** The text a retirement prints once it is done: what it rewrote, and every reference left to delete. */
function retirementText(
  flag: string,
  edits: RetireEdits,
  references: Reference[],
): string {
  const files = [...edits.overlays.map((o) => o.path), edits.manifest.path];
  const lines = [
    `Retired flag ${flag}: removed from ${files.join(", ")}; flag.retired recorded.`,
  ];
  if (references.length === 0) {
    lines.push(`No remaining reference to ${flag}.`);
  } else {
    lines.push(`Remaining references to ${flag} for the writer to delete:`);
    for (const reference of references) {
      lines.push(`  ${reference.path}:${reference.line}: ${reference.text}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The retirement as one JSON object: the files it rewrote and the references it left. */
function retirementJson(
  flag: string,
  edits: RetireEdits,
  references: Reference[],
): string {
  return `${JSON.stringify({
    flag,
    retired: true,
    overlays: edits.overlays.map((o) => o.path),
    manifest: edits.manifest.path,
    references,
  })}\n`;
}

/** The flag.retired event for a flag, checked against the ledger's rules before any file is written. */
function retiredEvent(flag: string, now: Date) {
  const event = {
    source: "claude",
    kind: "flag.retired",
    occurredAt: now.toISOString(),
    label: flag,
  };
  const checked = parseEvent(event, "input");
  if (!checked.ok) {
    throw new FlagError(
      `${flag} is not retired: its flag.retired ledger event is invalid: ${checked.message}. No file was written.`,
    );
  }
  return event;
}

/** Writes each rewritten overlay and then the manifest, under the repository root. */
async function writeEdits(
  fs: CommandContext["deps"]["fs"],
  base: string,
  edits: RetireEdits,
): Promise<void> {
  for (const overlay of edits.overlays) {
    await fs.writeFile(`${base}/${overlay.path}`, overlay.text);
  }
  await fs.writeFile(`${base}/${edits.manifest.path}`, edits.manifest.text);
}

/**
 * Retires one flag when the rule passes. The eligibility check and the event
 * are both settled before the first write, so a refused run writes nothing.
 * The event is recorded through the ledger here, the only code path that
 * writes a flag.retired event (ADR 0149).
 */
async function retireFlag(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const flag = retireTarget(context);
  const base = await root(context);
  const manifestText = await readManifestText(deps.fs, base);
  const entry = parseManifest(manifestText).find((e) => e.name === flag);
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new FlagError(opened.error);
  }
  const facts = await retireFactsOf({
    fs: deps.fs,
    clock: deps.clock,
    base,
    ledger: opened.ledger,
    release: await releaseLock(context, base),
    flag,
    entry,
  });
  const reasons = retireRefusals(facts);
  if (reasons.length > 0) {
    throw new FlagError(
      `${flag} is not eligible to retire: ${reasons.join("; ")}. No file or ledger event was written.`,
    );
  }
  const edits = await retireEdits(deps.fs, base, flag, manifestText);
  const event = retiredEvent(flag, deps.clock.now());
  await writeEdits(deps.fs, base, edits);
  const logged = await opened.ledger.record(event);
  if (!logged.ok) {
    throw new FlagError(
      `${flag} is retired, but its flag.retired ledger event was rejected: ${logged.message}. The files are already rewritten, so fix the ledger and do not rerun: a rerun finds nothing left to retire.`,
    );
  }
  const references = await remainingReferences(deps.runner, base, flag);
  deps.stdout(
    json
      ? retirementJson(flag, edits, references)
      : retirementText(flag, edits, references),
  );
  return 0;
}

export const retire: Command = {
  help: retireHelp,
  summary:
    "retire a feature flag that has soaked on in every environment it applies to, and list what still names it",
  operand: "flag",
  options: { ledger: "string", "chart-lock": "string" },
  run: (context) => guarded(context, () => retireFlag(context)),
};

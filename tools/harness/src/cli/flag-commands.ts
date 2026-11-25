import { IdeaRepository } from "../idea/index.js";
import { Ledger } from "../ledger/index.js";
import { openLedger } from "./ledger-commands.js";
import { auditHelp } from "./flag-audit-help.js";
import { auditVps } from "./flag-audit-vps.js";
import { noOutcomeMessage } from "./flag-activate-messages.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import {
  FlagError,
  activationProof,
  assertMayTurnOn,
  flagRequires,
  isWaiverRefusal,
  readOverlay,
  proofAudit,
  unprovenLine,
  waivedLine,
  withFlagOn,
} from "../flag/index.js";
import type { Proof } from "../flag/index.js";
import {
  FAILED,
  guarded,
  releaseLock,
  root,
  text,
} from "./flag-command-helpers.js";
import { progress } from "./flag-progress-command.js";

async function recordActivation(
  ledger: Ledger,
  { deps }: CommandContext,
  flag: string,
  environment: string,
  idea: string,
): Promise<void> {
  const event = await ledger.record({
    source: "claude",
    kind: "flag.activated",
    occurredAt: deps.clock.now().toISOString(),
    idea,
    label: `${flag}@${environment}`,
  });
  if (!event.ok) {
    throw new FlagError(
      `${flag} is on in ${environment}, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness flag activate ${flag} --environment ${environment}\` to record it.`,
    );
  }
}

function activationTarget(context: CommandContext) {
  const flag = context.operand;
  if (flag === undefined) {
    throw new FlagError(
      "Missing flag name; run `harness flag activate <flag> --environment <env>`.",
    );
  }
  const environment = text(context.options, "environment");
  if (environment === undefined) {
    throw new FlagError(
      "Missing --environment; run `harness flag activate <flag> --environment <env>`.",
    );
  }
  return { flag, environment };
}

/** The activation's output. A waiver stands in only after a live run was refused, so each reason is a warning: the waiver is never a silent fallback. */
function activationReport(
  flag: string,
  environment: string,
  proof: Proof,
  refused: string[],
  json: boolean,
): string {
  if (json) {
    const found = { flag, environment, idea: proof.idea, proof: proof.path };
    return `${JSON.stringify({ ...found, source: proof.source, ...(refused.length === 0 ? {} : { refused }) })}\n`;
  }
  const warnings = refused.map(
    (reason) =>
      `warning: a live run of ${flag} in ${environment} was refused, ${reason}\n`,
  );
  const waiver =
    proof.source === "owner-waiver"
      ? " under an owner waiver, not a live run"
      : "";
  return `${warnings.join("")}Flag ${flag} is on in ${environment}${waiver}; proof: ${proof.path}\n`;
}

async function activateFlag(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const { flag, environment } = activationTarget(context);
  const base = await root(context);
  const overlay = await readOverlay(deps.fs, base, environment);
  assertMayTurnOn(overlay, flag, await flagRequires(deps.fs, base, flag));
  const { proof, refused } = await activationProof(
    new IdeaRepository(deps.fs, deps.clock, base),
    flag,
    environment,
    await releaseLock(context, base),
    overlay.production,
  );
  if (proof === undefined && refused.length > 0) {
    // A refused waiver has no chart lock to re-prove, so when every refusal is one, only the live run's guidance answers it.
    throw new FlagError(
      refused.every(isWaiverRefusal)
        ? `${refused.join("; ")}. ${noOutcomeMessage(flag, environment, overlay)}`
        : `No live run of ${flag} in ${environment} counts, so ${overlay.path} is unchanged: ${refused.join("; ")}. Re-prove it live on charts equal to the release chart lock, then record a new verification outcome with --lock and --charts.`,
    );
  }
  if (proof === undefined) {
    throw new FlagError(noOutcomeMessage(flag, environment, overlay));
  }
  // The ledger opens before the write, so a missing ledger fails with the flag still off.
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new FlagError(opened.error);
  }
  const label = `${flag}@${environment}`;
  const logged = await opened.ledger.list({ kind: "flag.activated" });
  const recorded = logged.events.some((e) => e.label === label);
  // A turn-on records its event; a rerun on a flag already on only repairs a missing one.
  const turningOn = overlay.features[flag] !== true;
  if (turningOn) {
    await deps.fs.writeFile(
      `${base}/${overlay.path}`,
      withFlagOn(overlay, flag),
    );
  }
  if (turningOn || !recorded) {
    await recordActivation(
      opened.ledger,
      context,
      flag,
      environment,
      proof.idea,
    );
  }
  deps.stdout(activationReport(flag, environment, proof, refused, json));
  return 0;
}

async function auditFlags(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const base = await root(context);
  const { unproven, waived } = await proofAudit(deps.fs, deps.clock, base);
  if (unproven.length === 0) {
    deps.stdout(
      json
        ? `${JSON.stringify({ unproven, waived })}\n`
        : `Flag audit passed: no flag is on without proof.\n${waived.map((w) => `${waivedLine(w)}\n`).join("")}`,
    );
    return 0;
  }
  const lines = unproven.map(unprovenLine);
  deps.stderr(
    json
      ? `${JSON.stringify({ unproven, waived })}\n`
      : `${lines.join("\n")}\n`,
  );
  return FAILED;
}

/** The help record for `flag activate`: turns a flag on only after its verification outcome is recorded. */
const activateHelp: CommandHelp = {
  purpose:
    "Turns a feature flag on in an environment overlay (infra/environments/<environment>/environment.yaml) and records a flag.activated ledger event. It turns the flag on only when a confirmed verification outcome for that flag and environment is recorded, from a live run or an owner waiver; without one it changes nothing. In an environment the overlay marks production (ADR 0147) an owner waiver is not accepted: only a live run turns the flag on there.",
  when: "After a live run of the flag in the environment has been recorded with harness outcome record, to turn the flag on in that environment.",
  whenNot:
    "To see which flags that are on lack proof: use flag audit. To record a live run or a waiver: use outcome record, then return here. Do not edit the overlay by hand to turn a flag on: a flag the overlay does not declare is refused; declare it as false first.",
  flags: {
    environment:
      "The environment whose overlay turns the flag on, such as local. Required: the command never picks one for you.",
    ledger:
      "The ledger file the flag.activated event is recorded in, relative to the working directory; by default the shared ledger of the main checkout.",
    "chart-lock":
      "The release's platform-charts.lock.json, for a live run that recorded a main chart lock: the run counts only when its charts equal this release lock. A relative path is read from the repository root.",
  },
  operand:
    "The feature flag to turn on, as declared in the environment overlay.",
  examples: [
    {
      command: "harness flag activate behind-main-notice --environment local",
      shows:
        "with no confirmed verification outcome for behind-main-notice in local, the overlay is unchanged and the command exits 1, naming the outcome to record",
    },
    {
      command:
        "harness flag activate behind-main-notice --environment local --chart-lock platform-charts.lock.json",
      shows:
        "the flag on in the local overlay and its proof named, when a live run's charts equal the release lock",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the flag is on in the overlay and its proof is named; a rerun on a flag already on only repairs a missing ledger event",
    },
    {
      code: 1,
      meaning:
        "refused and the overlay is unchanged: a missing operand or --environment, an environment with no overlay, a flag the overlay does not declare, a flag whose required flag (infra/catalog/flags.yaml) is off in the environment, no confirmed verification outcome, an owner waiver in a production environment, a live run whose charts differ from --chart-lock, an unreadable chart lock, or a ledger that cannot be opened. Also when the flag is on but its ledger event is rejected: the flag stays on, and a rerun records the event",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "when the flag is off, rewrites its false entry to true in infra/environments/<environment>/environment.yaml and appends one flag.activated event to the ledger; a refused run writes nothing",
  },
  seeAlso: ["flag audit", "outcome record"],
};

const activate: Command = {
  help: activateHelp,
  summary:
    "turn a flag on in an environment overlay, only after a recorded verification outcome",
  operand: "flag",
  options: { environment: "string", ledger: "string", "chart-lock": "string" },
  run: (context) => guarded(context, () => activateFlag(context)),
};

const audit: Command = {
  help: auditHelp,
  summary:
    "fail when a flag is on in any environment overlay without a recorded verification outcome",
  options: { vps: "boolean" },
  run: (context) =>
    guarded(context, async () =>
      context.options["vps"] === true
        ? auditVps(context, await root(context))
        : auditFlags(context),
    ),
};

export const flagCommands: Record<string, Command> = {
  activate,
  audit,
  progress,
};

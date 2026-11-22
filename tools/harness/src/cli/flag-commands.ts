import { IdeaRepository } from "../idea/index.js";
import { Ledger } from "../ledger/index.js";
import { openLedger } from "./ledger-commands.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import {
  FlagError,
  activationProof,
  parseReleaseLock,
  readOverlay,
  proofAudit,
  unprovenLine,
  waivedLine,
  withFlagOn,
} from "../flag/index.js";
import type { Proof } from "../flag/index.js";

const FAILED = 1;

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<number>,
): Promise<number> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof FlagError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}\n` : "";
    deps.stderr(`${prefix}${error.message}\n`);
    return FAILED;
  }
}

async function root(context: CommandContext): Promise<string> {
  return await context.deps.root().catch((cause: unknown) => {
    throw new FlagError(cause instanceof Error ? cause.message : String(cause));
  });
}

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

/** The release chart lock named by --chart-lock, or undefined when none is named. */
async function releaseLock(context: CommandContext, base: string) {
  const path = text(context.options, "chart-lock");
  if (path === undefined) {
    return undefined;
  }
  const lockText = await context.deps.fs
    .readFile(path.startsWith("/") ? path : `${base}/${path}`)
    .catch((cause: unknown) => {
      throw new FlagError(
        `Cannot read the release chart lock ${path}: ${cause instanceof Error ? cause.message : String(cause)}. Pass --chart-lock <platform-charts.lock.json> attached to the release.`,
      );
    });
  return parseReleaseLock(lockText, path);
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
  if (!Object.hasOwn(overlay.features, flag)) {
    throw new FlagError(
      `${overlay.path} does not declare flag "${flag}". Declared: ${Object.keys(overlay.features).join(", ") || "none"}. Declare it as false first.`,
    );
  }
  const { proof, refused } = await activationProof(
    new IdeaRepository(deps.fs, deps.clock, base),
    flag,
    environment,
    await releaseLock(context, base),
  );
  if (proof === undefined && refused.length > 0) {
    throw new FlagError(
      `No live run of ${flag} in ${environment} counts, so ${overlay.path} is unchanged: ${refused.join("; ")}. Re-prove it live on charts equal to the release chart lock, then record a new verification outcome with --lock and --charts.`,
    );
  }
  if (proof === undefined) {
    throw new FlagError(
      `No verification outcome records a live run or an owner waiver of ${flag} in ${environment}, so ${overlay.path} is unchanged. Prove it live, then run \`harness outcome record --idea <number> --kind verification --source live-run --result confirmed --flag ${flag} --environment ${environment} --evidence <run> --summary <text>\`. Or, when the owner has waived the live run in a GitHub comment, use \`--source owner-waiver --evidence <comment url>\`.`,
    );
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
    "Turns a feature flag on in an environment overlay (infra/environments/<environment>/environment.yaml) and records a flag.activated ledger event. It turns the flag on only when a confirmed verification outcome for that flag and environment is recorded, from a live run or an owner waiver; without one it changes nothing.",
  when: "After a live run of the flag in the environment has been recorded with harness outcome record, to turn the flag on in that environment.",
  whenNot:
    "To see which flags that are on lack proof: use flag audit. To record a live run or a waiver: use outcome record, then return here. Do not edit the overlay by hand to turn a flag on: a flag the overlay does not declare as false is refused.",
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
      command: "harness flag activate hc-sessions --environment local",
      shows:
        "with no confirmed verification outcome for hc-sessions in local, the overlay is unchanged and the command exits 1, naming the outcome to record",
    },
    {
      command:
        "harness flag activate hc-sessions --environment local --chart-lock platform-charts.lock.json",
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
        "refused and the overlay is unchanged: a missing operand or --environment, an environment with no overlay, a flag the overlay does not declare, no confirmed verification outcome, a live run whose charts differ from --chart-lock, an unreadable chart lock, or a ledger that cannot be opened. Also when the flag is on but its ledger event is rejected: the flag stays on, and a rerun records the event",
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
    "turn a flag on in an environment overlay, only when a confirmed verification outcome from a live run or an owner waiver names that flag and environment; a live run that records a main chart lock counts only when its charts equal the release chart lock given by --chart-lock; records a flag.activated ledger event (<flag> --environment <env> [--chart-lock <platform-charts.lock.json>] [--ledger])",
  operand: "flag",
  options: { environment: "string", ledger: "string", "chart-lock": "string" },
  run: (context) => guarded(context, () => activateFlag(context)),
};

/** The help record for `flag audit`: fails on any flag that is on without recorded proof. */
const auditHelp: CommandHelp = {
  purpose:
    "Checks every flag that is on in any environment overlay for its recorded proof. It fails when a flag is on with no confirmed verification outcome, from a live run or an owner waiver, and names each flag that rests on a waiver rather than a live run. kb-check reports the same flags as warnings.",
  when: "Before a release, or when kb-check warns about a flag, to find flags that are on without proof.",
  whenNot:
    "To turn a flag on: use flag activate, which refuses without proof. To read the recorded outcome itself: use idea show for the idea that holds it.",
  flags: {},
  examples: [
    {
      command: "harness flag audit",
      shows:
        "Flag audit passed: no flag is on without proof, with a line for each flag that rests on an owner waiver",
    },
    {
      command: "harness flag audit --json",
      shows:
        "unproven and waived as one JSON object: on stdout when the audit passes, on stderr with exit 1 when it fails",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "no flag is on without proof; a flag under an owner waiver is listed and does not fail",
    },
    {
      code: 1,
      meaning:
        "at least one flag is on with no verification outcome; each is named on stderr with the step to fix it",
    },
    {
      code: 2,
      meaning: "a flag the command does not declare",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads each environment overlay and the idea records; writes nothing",
  },
  seeAlso: ["flag activate", "idea show"],
};

const audit: Command = {
  help: auditHelp,
  summary:
    "fail when any flag in any environment overlay is on without a confirmed verification outcome from a live run or an owner waiver, and names each flag that rests on a waiver; kb-check reports it as a warning (audit mode, ADR 0080)",
  run: (context) => guarded(context, () => auditFlags(context)),
};

export const flagCommands: Record<string, Command> = { activate, audit };

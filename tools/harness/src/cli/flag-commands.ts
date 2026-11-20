import { IdeaRepository } from "../idea/index.js";
import { Ledger } from "../ledger/index.js";
import { openLedger } from "./ledger-commands.js";
import type { Command, CommandContext } from "../runtime/index.js";
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
  deps.stdout(
    json
      ? `${JSON.stringify({ flag, environment, idea: proof.idea, proof: proof.path, source: proof.source })}\n`
      : `Flag ${flag} is on in ${environment}${proof.source === "owner-waiver" ? " under an owner waiver, not a live run" : ""}; proof: ${proof.path}\n`,
  );
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

const activate: Command = {
  summary:
    "turn a flag on in an environment overlay, only when a confirmed verification outcome from a live run or an owner waiver names that flag and environment; a live run that records a main chart lock counts only when its charts equal the release chart lock given by --chart-lock; records a flag.activated ledger event (<flag> --environment <env> [--chart-lock <platform-charts.lock.json>] [--ledger])",
  operand: "flag",
  options: { environment: "string", ledger: "string", "chart-lock": "string" },
  run: (context) => guarded(context, () => activateFlag(context)),
};

const audit: Command = {
  summary:
    "fail when any flag in any environment overlay is on without a confirmed verification outcome from a live run or an owner waiver, and names each flag that rests on a waiver; kb-check reports it as a warning (audit mode, ADR 0080)",
  run: (context) => guarded(context, () => auditFlags(context)),
};

export const flagCommands: Record<string, Command> = { activate, audit };

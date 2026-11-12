import { IdeaRepository } from "../idea/index.js";
import { Ledger } from "../ledger/index.js";
import { openLedger } from "./ledger-commands.js";
import type { Command, CommandContext } from "../runtime/index.js";
import {
  FlagError,
  findProof,
  environments,
  readOverlay,
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
  const proof = await findProof(
    new IdeaRepository(deps.fs, deps.clock, base),
    flag,
    environment,
  );
  if (proof === undefined) {
    throw new FlagError(
      `No verification outcome records a live run of ${flag} in ${environment}, so ${overlay.path} is unchanged. Prove it live, then run \`harness outcome record --idea <number> --kind verification --source live-run --result confirmed --flag ${flag} --environment ${environment} --evidence <run> --summary <text>\`.`,
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
  if (overlay.features[flag] !== true) {
    await deps.fs.writeFile(
      `${base}/${overlay.path}`,
      withFlagOn(overlay, flag),
    );
  }
  // A rerun repairs an activation whose event was rejected, and records nothing twice.
  if (!recorded) {
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
      ? `${JSON.stringify({ flag, environment, idea: proof.idea, proof: proof.path })}\n`
      : `Flag ${flag} is on in ${environment}; proof: ${proof.path}\n`,
  );
  return 0;
}

async function auditFlags(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const base = await root(context);
  const repo = new IdeaRepository(deps.fs, deps.clock, base);
  const unproven: { flag: string; environment: string; path: string }[] = [];
  for (const environment of await environments(deps.fs, base)) {
    const overlay = await readOverlay(deps.fs, base, environment);
    for (const [flag, on] of Object.entries(overlay.features)) {
      if (on && (await findProof(repo, flag, environment)) === undefined) {
        unproven.push({ flag, environment, path: overlay.path });
      }
    }
  }
  if (unproven.length === 0) {
    deps.stdout(
      json
        ? `${JSON.stringify({ unproven })}\n`
        : "Flag audit passed: no flag is on without proof.\n",
    );
    return 0;
  }
  const lines = unproven.map(
    (u) =>
      `Flag ${u.flag} is on in ${u.environment} (${u.path}) with no verification outcome. Set it back to false, then turn it on with \`harness flag activate ${u.flag} --environment ${u.environment}\` once a live run is recorded.`,
  );
  deps.stderr(
    json ? `${JSON.stringify({ unproven })}\n` : `${lines.join("\n")}\n`,
  );
  return FAILED;
}

const activate: Command = {
  summary:
    "turn a flag on in an environment overlay, only when a confirmed live-run verification outcome names that flag and environment; records a flag.activated ledger event (<flag> --environment <env> [--ledger])",
  operand: "flag",
  options: { environment: "string", ledger: "string" },
  run: (context) => guarded(context, () => activateFlag(context)),
};

const audit: Command = {
  summary:
    "fail when any flag in any environment overlay is on without a confirmed live-run verification outcome; runs in CI through kb-check",
  run: (context) => guarded(context, () => auditFlags(context)),
};

export const flagCommands: Record<string, Command> = { activate, audit };

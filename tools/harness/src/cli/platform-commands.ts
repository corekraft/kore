import {
  formatCharts,
  parseCharts,
  type LedgerEvent,
} from "../ledger/index.js";
import {
  RolloutError,
  compareRollout,
  type Comparison,
  parseChartRows,
  readRolloutLocks,
} from "../rollout/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { driftHelp, recordHelp } from "./platform-help.js";

// Docs: docs/decisions/0150-platform-releases-reach-vps-by-a-recorded-rollout-and-roll-back-by-revert.md

const FAILED = 1;
const RECORD_USAGE =
  "harness platform rollout-record --environment <env> --tag <tag> --chart-lock <file> --image-lock <file>";

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** A refusal: its message on stderr, with a JSON line first under --json, and exit 1. */
function refuse({ json, deps }: CommandContext, message: string): number {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return FAILED;
}

/** Runs a command, turning a RolloutError into a refusal and rethrowing anything else. */
async function guarded(
  context: CommandContext,
  action: () => Promise<number>,
): Promise<number> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof RolloutError) {
      return refuse(context, error.message);
    }
    throw error;
  }
}

function required(context: CommandContext, name: string, usage: string) {
  const value = text(context.options, name);
  if (value === undefined) {
    throw new RolloutError(`Missing --${name}; run \`${usage}\`.`);
  }
  return value;
}

async function readText(
  context: CommandContext,
  base: string,
  path: string,
  what: string,
): Promise<string> {
  const absolute = path.startsWith("/") ? path : `${base}/${path}`;
  return await context.deps.fs.readFile(absolute).catch((cause: unknown) => {
    throw new RolloutError(
      `Cannot read the ${what} ${path}: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  });
}

async function recordRollout(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const environment = required(context, "environment", RECORD_USAGE);
  const tag = required(context, "tag", RECORD_USAGE);
  const chartPath = required(context, "chart-lock", RECORD_USAGE);
  const imagePath = required(context, "image-lock", RECORD_USAGE);
  const base = await deps.root();
  const locks = readRolloutLocks({
    tag,
    chart: await readText(context, base, chartPath, "release chart lock"),
    image: await readText(context, base, imagePath, "release image lock"),
  });
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new RolloutError(opened.error);
  }
  const recorded = await opened.ledger.record({
    source: "claude",
    kind: "platform.rolled-out",
    occurredAt: deps.clock.now().toISOString(),
    environment,
    tag,
    chartLock: locks.chartLock,
    imageLock: locks.imageLock,
    charts: formatCharts(locks.charts),
  });
  if (!recorded.ok) {
    throw new RolloutError(
      `The rollout was not recorded: ${recorded.message} Fix the ledger and rerun the command.`,
    );
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ environment, tag, chartLock: locks.chartLock, imageLock: locks.imageLock, charts: locks.charts.length })}\n`
      : `Recorded platform.rolled-out: ${environment} at ${tag}, ${locks.charts.length} charts, chart lock ${locks.chartLock}\n`,
  );
  return 0;
}

const rolloutRecord: Command = {
  help: recordHelp,
  summary:
    "record a platform rollout in the ledger, refusing a lock that is not the release's",
  options: {
    environment: "string",
    tag: "string",
    "chart-lock": "string",
    "image-lock": "string",
    ledger: "string",
  },
  run: (context) => guarded(context, () => recordRollout(context)),
};

const DRIFT_USAGE =
  "kore platform status --environment <env> --json | harness platform rollout-drift --environment <env>";

/** Prints the comparison against the recorded rollout and returns the exit code: 0 only when something was compared and nothing differs. */
function reportDrift(
  context: CommandContext,
  last: LedgerEvent,
  result: Comparison,
): number {
  const { deps, json } = context;
  const found = {
    environment: last.environment,
    tag: last.tag,
    recordedAt: last.occurredAt,
  };
  const notCompared = result.notCompared.map((line) => `  ${line}`);
  const trailer =
    notCompared.length === 0
      ? ""
      : `Not compared:\n${notCompared.join("\n")}\n`;
  const clean = result.differences.length === 0 && result.compared > 0;
  if (json) {
    const line = `${JSON.stringify({ ...found, ...result })}\n`;
    if (clean) {
      deps.stdout(line);
    } else {
      deps.stderr(line);
    }
    return clean ? 0 : FAILED;
  }
  if (clean) {
    deps.stdout(
      `No drift: the ${result.compared} compared chart${result.compared === 1 ? "" : "s"} ${result.compared === 1 ? "matches" : "match"} the rollout of ${last.tag} recorded at ${last.occurredAt}.\n${trailer}`,
    );
    return 0;
  }
  const lines =
    result.compared === 0
      ? `Nothing could be compared with the rollout of ${last.tag} recorded at ${last.occurredAt}: no recorded chart has a Helm release row in the status.\n`
      : `Drift from the rollout of ${last.tag} recorded at ${last.occurredAt}:\n${result.differences.map((line) => `  ${line}`).join("\n")}\n`;
  deps.stderr(`${lines}${trailer}`);
  return FAILED;
}

async function driftCheck(context: CommandContext): Promise<number> {
  const { deps } = context;
  const environment = required(context, "environment", DRIFT_USAGE);
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new RolloutError(opened.error);
  }
  const { events } = await opened.ledger.list({ kind: "platform.rolled-out" });
  const last = events.findLast((event) => event.environment === environment);
  if (last === undefined) {
    return refuse(
      context,
      `No platform rollout is recorded for ${environment}, so there is nothing to compare; run \`harness platform rollout-record --environment ${environment}\` after \`kore platform up\`, then rerun this check.`,
    );
  }
  const statusPath = text(context.options, "status");
  const status =
    statusPath === undefined
      ? await deps.stdin()
      : await readText(context, await deps.root(), statusPath, "status file");
  return reportDrift(
    context,
    last,
    compareRollout(parseCharts(last.charts ?? ""), parseChartRows(status)),
  );
}

const rolloutDrift: Command = {
  help: driftHelp,
  summary:
    "compare the last recorded rollout with the cluster's installed charts and name each difference",
  options: { environment: "string", status: "string", ledger: "string" },
  run: (context) => guarded(context, () => driftCheck(context)),
};

export const platformCommands: Record<string, Command> = {
  "rollout-record": rolloutRecord,
  "rollout-drift": rolloutDrift,
};

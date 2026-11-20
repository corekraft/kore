import type { Repository } from "../config/index.js";
import {
  ChartPackagingError,
  chartLockDrift,
  chartLockDriftMessage,
  composeChartDelivery,
  composeGoldenPathDelivery,
  fetchMainChartLock,
  upChartLockDrift,
} from "../platform/index.js";
import type { Runner } from "../runtime/index.js";
import type { CommandContext } from "./context.js";
import { boolFlag, stringFlag } from "./flags.js";
import { print } from "./output.js";

/**
 * Compares the chart lock with the checkout's charts before any cluster work.
 * Outside a proof, running ahead of the last release is normal, so a difference
 * (or packaging that cannot run) is a warning, and any other failure of the
 * check, a lock or release problem, is refused; under `--require-fresh-lock` it
 * refuses, because a proof of a lock that lacks the change tests nothing new.
 */
async function checkChartLockFreshness(
  repository: Repository,
  runner: Runner,
  lockPath: string | undefined,
  required: boolean,
): Promise<void> {
  if (required && lockPath === undefined) {
    throw new Error(
      "--require-fresh-lock needs --platform-chart-lock <platform-charts.lock.json>, the lock the proof will install from",
    );
  }
  try {
    const rows = await upChartLockDrift(repository, runner, lockPath);
    if (rows.some((row) => row.drift) && lockPath !== undefined) {
      const message = chartLockDriftMessage(rows, lockPath);
      if (required) {
        throw new Error(message);
      }
      process.stderr.write(`warning: ${message}\n`);
    }
  } catch (error) {
    if (required || !(error instanceof ChartPackagingError)) {
      throw error;
    }
    process.stderr.write(
      `warning: the chart lock was not compared with the checkout: ${error.message}\n`,
    );
  }
}

/**
 * The read-only `fetch-lock`: writes the main chart lock of a commit, the
 * checkout's HEAD by default, to the path given, so a proof can pass it to
 * `--platform-chart-lock`. It touches no cluster and needs no environment lock.
 */
export async function fetchChartLock(context: CommandContext): Promise<number> {
  const output = stringFlag(context.parsed, "output");
  if (output === undefined) {
    throw new Error(
      "kore local fetch-lock needs --output <platform-charts.lock.json>, the path the lock is written to",
    );
  }
  if (context.parsed.flags.get("commit") === true) {
    throw new Error(
      "kore local fetch-lock --commit needs the sha of the commit whose lock to fetch; omit --commit for the checkout's HEAD",
    );
  }
  const lock = await fetchMainChartLock(context.runner, {
    root: context.repository.root,
    commit: stringFlag(context.parsed, "commit"),
    output,
  });
  print(
    { status: "fetched", commit: lock.commit, path: lock.path },
    context.json,
  );
  return 0;
}

/** The read-only `lock-check`: one row per handed-over release, nonzero on drift. */
export async function lockCheck(context: CommandContext): Promise<number> {
  const lockPath = stringFlag(context.parsed, "platform-chart-lock");
  if (lockPath === undefined) {
    throw new Error(
      "kore local lock-check needs --platform-chart-lock <platform-charts.lock.json>, the release asset published with the charts",
    );
  }
  const releases = await chartLockDrift(
    context.repository,
    context.runner,
    lockPath,
  );
  const drifted = releases.filter((row) => row.drift).map((row) => row.name);
  print(
    {
      verdict:
        drifted.length > 0
          ? `drift in ${drifted.join(", ")}: this run would test the published chart, not the repository's; the fix is a release or a main publish that contains the change`
          : `no drift: the chart lock matches this checkout for ${releases.length} release${releases.length === 1 ? "" : "s"}`,
      releases,
    },
    context.json,
  );
  return drifted.length > 0 ? 1 : 0;
}

/**
 * What `local up` brings up: the repository with both release locks composed
 * into the delivery values, after the chart lock is compared with the checkout.
 * Everything here runs before any cluster call.
 */
export async function composeLocalDelivery(
  context: CommandContext,
  runner: Runner,
): Promise<Repository> {
  const { repository, parsed } = context;
  const chartLock = stringFlag(parsed, "platform-chart-lock");
  const charts = await composeChartDelivery(repository, chartLock);
  await checkChartLockFreshness(
    repository,
    runner,
    chartLock,
    boolFlag(parsed, "require-fresh-lock"),
  );
  return await composeGoldenPathDelivery(
    charts,
    runner,
    stringFlag(parsed, "platform-template-lock"),
  );
}

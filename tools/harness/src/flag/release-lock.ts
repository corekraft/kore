import { FlagError } from "./overlay.js";
import type { RecordedChart } from "./recorded-lock.js";

/** The version and digest of each release in a chart lock, by release name. */
export type ReleaseLock = Record<string, { version: string; digest: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** The release chart lock's versions and digests; refuses a file that is not a `{version: 1, entries}` lock with both on every entry. */
export function parseReleaseLock(text: string, path: string): ReleaseLock {
  const refusal = new FlagError(
    `${path} must be {version: 1, entries: {<release>: {chart, digest, version}}}; pass the platform-charts.lock.json attached to the release.`,
  );
  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    throw refusal;
  }
  if (!isRecord(lock) || lock["version"] !== 1 || !isRecord(lock["entries"])) {
    throw refusal;
  }
  const found: ReleaseLock = {};
  for (const [name, entry] of Object.entries(lock["entries"])) {
    if (
      !isRecord(entry) ||
      typeof entry["version"] !== "string" ||
      typeof entry["digest"] !== "string"
    ) {
      throw refusal;
    }
    found[name] = { version: entry["version"], digest: entry["digest"] };
  }
  return found;
}

/** One line per recorded chart that is not exactly in the release lock, naming what differs. */
export function chartDifferences(
  charts: readonly RecordedChart[],
  release: ReleaseLock,
): string[] {
  return charts.flatMap((chart) => {
    const actual = Object.hasOwn(release, chart.name)
      ? release[chart.name]
      : undefined;
    if (actual === undefined) {
      return [`${chart.name} (not in the release lock)`];
    }
    const parts = [
      ...(chart.version === actual.version
        ? []
        : [`version ${chart.version}, release lock ${actual.version}`]),
      ...(chart.digest === actual.digest
        ? []
        : [`digest ${chart.digest}, release lock ${actual.digest}`]),
    ];
    return parts.length === 0 ? [] : [`${chart.name} (${parts.join("; ")})`];
  });
}

/** One chart a live proof ran on, as the chart lock recorded it. */
export interface RecordedChart {
  name: string;
  version: string;
  digest: string;
}

/**
 * The chart lock an outcome states. `none` is an outcome that records neither
 * a lock kind nor charts (every older outcome); `invalid` is a partial or
 * unreadable record, which is refused rather than read as `none`.
 */
export type ProofLock =
  | { kind: "none" }
  | { kind: "release" }
  | { kind: "main"; charts: RecordedChart[] }
  | { kind: "invalid"; reason: string };

const ENTRY =
  /^([A-Za-z0-9][A-Za-z0-9._-]*)=([^@\s;=]+)@(sha256:[0-9a-f]{64})$/;
const SHAPE = "<name>=<version>@sha256:<64 hex>";

/** The one-line form an outcome carries: `name=version@digest`, entries joined by a semicolon. */
export function renderCharts(charts: readonly RecordedChart[]): string {
  return charts.map((c) => `${c.name}=${c.version}@${c.digest}`).join("; ");
}

/** The charts of a recorded line, or what is wrong with it; an empty list is an error, never "no lock". */
export function parseCharts(
  text: string,
): { charts: RecordedChart[] } | { error: string } {
  if (text.trim() === "") {
    return { error: `no charts are recorded; name each as ${SHAPE}` };
  }
  const charts: RecordedChart[] = [];
  for (const raw of text.split(";")) {
    const entry = raw.trim();
    const match = ENTRY.exec(entry);
    if (match?.[1] === undefined || match[2] === undefined) {
      return {
        error: `"${entry}" is not ${SHAPE}; record the chart's version and digest from the lock`,
      };
    }
    if (charts.some((c) => c.name === match[1])) {
      return { error: `chart ${match[1]} is listed twice` };
    }
    charts.push({
      name: match[1],
      version: match[2],
      digest: match[3] ?? "",
    });
  }
  return { charts };
}

/** The lock an outcome's field block states; a partial record is `invalid`, so it is never read as no lock. */
export function readProofLock(fields: ReadonlyMap<string, string>): ProofLock {
  const kind = fields.get("Lock");
  const charts = fields.get("Charts");
  if (kind === undefined) {
    return charts === undefined
      ? { kind: "none" }
      : { kind: "invalid", reason: "it records charts but no lock kind" };
  }
  if (kind === "release") {
    return { kind: "release" };
  }
  if (kind !== "main") {
    return {
      kind: "invalid",
      reason: `its lock "${kind}" is neither main nor release`,
    };
  }
  if (charts === undefined) {
    return {
      kind: "invalid",
      reason: "its lock is main but it records no charts",
    };
  }
  const parsed = parseCharts(charts);
  return "error" in parsed
    ? {
        kind: "invalid",
        reason: `its recorded charts are unusable: ${parsed.error}`,
      }
    : { kind: "main", charts: parsed.charts };
}

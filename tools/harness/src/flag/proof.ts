import { IdeaRepository, outcomeSection } from "../idea/index.js";
import {
  NO_SOURCES,
  type AppFlagWindows,
  type ProofSources,
} from "./app-windows.js";
import { readProofLock } from "./recorded-lock.js";
import { chartDifferences, type ReleaseLock } from "./release-lock.js";

/** What stood in for the live run: the run itself, or the owner's recorded waiver of it. */
export type ProofSource = "live-run" | "owner-waiver";

export interface Proof {
  idea: string;
  path: string;
  source: ProofSource;
}

/** An app flag's platform window: the platform's record of a confirmed activation window, not an idea. */
export interface WindowProof {
  source: "platform-window";
  path: string;
}

/** The proof findProof returns: an idea's live run or waiver, or an app flag's platform window. */
export type FoundProof = Proof | WindowProof;

/** The tool's field block: the lines under `## Outcome` up to the first blank line. The summary after it is free text. */
function fieldBlock(section: string): string[] {
  const body = section.split("\n").slice(1);
  const start = body.findIndex((line) => line.trim() !== "");
  const rest = start === -1 ? [] : body.slice(start);
  const end = rest.findIndex((line) => line.trim() === "");
  return end === -1 ? rest : rest.slice(0, end);
}

function lines(section: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of fieldBlock(section)) {
    const match = /^- ([A-Za-z]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined && !found.has(match[1])) {
      found.set(match[1], (match[2] ?? "").trim());
    }
  }
  return found;
}

/** What activation made of the recorded outcomes: the proof that counts, and why each live run that was read before it was refused. */
export interface ActivationProof {
  proof: Proof | undefined;
  refused: string[];
}

/** Why a live-run outcome's recorded lock does not count, or undefined when it does. */
type Judge = (path: string, fields: Map<string, string>) => string | undefined;

/** Reads every matching outcome, a live run over a waiver, skipping each live run the judge refuses. */
async function scan(
  repo: IdeaRepository,
  flag: string,
  environment: string,
  judge: Judge,
): Promise<ActivationProof> {
  let waived: Proof | undefined;
  const refused: string[] = [];
  for (const record of await repo.list()) {
    const section = outcomeSection(await repo.source(record));
    if (section === undefined) {
      continue;
    }
    const fields = lines(section);
    const source = fields.get("Source");
    if (
      fields.get("Result") !== "confirmed" ||
      fields.get("Kind") !== "verification" ||
      fields.get("Flag") !== flag ||
      fields.get("Environment") !== environment
    ) {
      continue;
    }
    if (source === "live-run") {
      const reason = judge(record.path, fields);
      if (reason === undefined) {
        return {
          proof: { idea: record.number, path: record.path, source },
          refused: [],
        };
      }
      refused.push(reason);
    }
    if (source === "owner-waiver" && waived === undefined) {
      waived = { idea: record.number, path: record.path, source };
    }
  }
  return { proof: waived, refused };
}

/** The platform's confirmed verification window for this app flag in this environment, if one is on record. */
async function platformWindow(
  windows: AppFlagWindows,
  flag: string,
  environment: string,
): Promise<WindowProof | undefined> {
  const record = (await windows.list(flag, environment)).find(
    (w) =>
      w.flag === flag &&
      w.environment === environment &&
      w.kind === "verification" &&
      w.result === "confirmed",
  );
  return record === undefined
    ? undefined
    : { source: "platform-window", path: record.path };
}

/**
 * The proof on record for this flag in this environment: an idea's confirmed
 * live run, else its owner waiver, else for an app flag only a confirmed
 * platform window (ADR 0174). A live run wins over a waiver, and a waiver over
 * a window, so the waiver stays visible in the audit. Only the outcome tool
 * writes the idea block, and it rejects summary lines shaped like a field, so a
 * match is proof on record (ADR 0077). A platform flag never takes a window.
 * It does not compare charts: the audit has no release lock, and activation,
 * which does, uses `activationProof`.
 */
export async function findProof(
  repo: IdeaRepository,
  flag: string,
  environment: string,
  sources: ProofSources = NO_SOURCES,
): Promise<FoundProof | undefined> {
  const idea = (await scan(repo, flag, environment, () => undefined)).proof;
  if (idea !== undefined) {
    return idea;
  }
  return sources.isAppFlag(flag)
    ? await platformWindow(sources.windows, flag, environment)
    : undefined;
}

/**
 * The proof activation counts. A live run that records a main chart lock
 * counts only when every recorded chart has the release lock's version and
 * digest; a partial lock record never counts; a live run with no lock or a
 * release lock, and an owner waiver, count as in `findProof` (ADR 0138).
 * `refused` names why each matching live run was refused. It is empty when a
 * live run counts, and kept when an owner waiver stands in, so the caller can
 * warn that the waiver replaced a refused run.
 */
export function activationProof(
  repo: IdeaRepository,
  flag: string,
  environment: string,
  release: ReleaseLock | undefined,
): Promise<ActivationProof> {
  return scan(repo, flag, environment, (path, fields) => {
    const lock = readProofLock(fields);
    if (lock.kind === "invalid") {
      return `${path}: ${lock.reason}`;
    }
    if (lock.kind !== "main") {
      return undefined;
    }
    if (release === undefined) {
      return `${path}: it is a main-lock proof, so activation compares it with the release chart lock; pass --chart-lock <platform-charts.lock.json> of the release`;
    }
    const differing = chartDifferences(lock.charts, release);
    return differing.length === 0
      ? undefined
      : `${path}: its main-lock charts differ from the release lock: ${differing.join(", ")}`;
  });
}

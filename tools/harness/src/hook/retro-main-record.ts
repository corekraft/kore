// Records one retro scan's main-session figures as a retro.main-session ledger event
// (#940), when the local overlay turns the main-session-figures flag on. The event
// holds the scanned window and five numbers, never command text.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

import { environments, readOverlay } from "../flag/index.js";
import type { Ledger } from "../ledger/index.js";
import {
  CommandError,
  type CliDeps,
  type Clock,
  type FileSystem,
} from "../runtime/index.js";
import { mainLedger } from "./retro-ledger.js";
import { windowStart } from "./retro-marker.js";
import type { MainSessionReport } from "./retro-main-tally.js";

/** The feature flag that turns the recording on; off in every overlay until the owner turns it on. */
export const MAIN_SESSION_FLAG = "main-session-figures";

const ENVIRONMENT = "local";

export interface MainSessionRecordPorts {
  ledger: Pick<Ledger, "record">;
  clock: Pick<Clock, "now">;
  fs: FileSystem;
  /** The repository root the environment overlays are read from. */
  root: string;
}

export interface MainSessionScan {
  /** Epoch ms the scanned window opens at; 0 when the scan had no start. */
  start: number;
  /** Epoch ms the scan ran at, which closes its window. */
  end: number;
  figures: MainSessionReport;
}

/** Whether the local overlay turns the flag on. No overlay means off. */
async function flagOn(fs: FileSystem, root: string): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[MAIN_SESSION_FLAG] === true;
}

/**
 * Records a scan of the repository's own transcripts: its window opens at the
 * scan's `since` (the epoch when it had none) and closes now, and the event goes
 * to the main checkout's ledger. False when there is no main checkout or the flag is off.
 */
export async function recordScanFigures(
  deps: CliDeps,
  root: string,
  since: string | undefined,
  figures: MainSessionReport,
): Promise<boolean> {
  const ledger = await mainLedger(deps);
  if (ledger === undefined) {
    return false;
  }
  return recordMainSession(
    { ledger, clock: deps.clock, fs: deps.fs, root },
    { start: windowStart(since), end: deps.clock.now().getTime(), figures },
  );
}

/**
 * Appends the scan's event when the flag is on, and says whether it did. A
 * refused event throws with the ledger's reason and the fix, so a scan never
 * reports figures it did not keep.
 */
export async function recordMainSession(
  ports: MainSessionRecordPorts,
  scan: MainSessionScan,
): Promise<boolean> {
  if (!(await flagOn(ports.fs, ports.root))) {
    return false;
  }
  const { figures } = scan;
  const written = await ports.ledger.record({
    source: "claude",
    kind: "retro.main-session",
    occurredAt: ports.clock.now().toISOString(),
    windowStart: new Date(scan.start).toISOString(),
    windowEnd: new Date(scan.end).toISOString(),
    pollMinutes: figures.pollMinutes,
    paneReads: figures.paneReads,
    signedSends: figures.signedSends,
    rawSends: figures.rawSends,
  });
  if (!written.ok) {
    throw new CommandError(
      `The retro.main-session event was rejected: ${written.message} Fix the ledger, then rerun \`harness hook retro-scan\`.`,
    );
  }
  return true;
}

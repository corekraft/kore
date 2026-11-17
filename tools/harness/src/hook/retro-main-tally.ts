// The retro scan's roll-up of the main session's own figures (#940): summed over the
// main sessions only. A session with a spawn-brief name is a role's, and its figures
// are left out, whatever its transcript shows.

import type { SessionAnalysis } from "./retro-session.js";

/** The main session's figures in the scan report: poll minutes to four places, and whole counts. */
export interface MainSessionReport {
  sessions: number;
  pollMinutes: number;
  paneReads: number;
  signedSends: number;
  rawSends: number;
}

const MS_PER_MINUTE = 60_000;

export class MainSessionTally {
  private sessions = 0;
  private pollMs = 0;
  private reads = 0;
  private signed = 0;
  private raw = 0;

  add(found: Pick<SessionAnalysis, "sessionName" | "main">): void {
    if (found.sessionName !== undefined) {
      return;
    }
    this.sessions++;
    this.pollMs += found.main.pollMs;
    this.reads += found.main.reads;
    this.signed += found.main.signed;
    this.raw += found.main.raw;
  }

  report(): MainSessionReport {
    return {
      sessions: this.sessions,
      pollMinutes: Math.round((this.pollMs / MS_PER_MINUTE) * 10_000) / 10_000,
      paneReads: this.reads,
      signedSends: this.signed,
      rawSends: this.raw,
    };
  }
}

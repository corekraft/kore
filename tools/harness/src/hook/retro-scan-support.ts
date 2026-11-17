import { vi } from "vitest";
import { parseTranscript, timestamps } from "./retro-transcript.js";
// Fakes for the retro scan unit spec: a session analysis as the scan reads it,
// and a warning as the analysis records it. Fakes only; no behaviour.

import { SessionAnalysis, type Warning } from "./retro-session.js";

/** The analysis members the scan reads, as the scan reads them. */
export type Visible = Pick<
  SessionAnalysis,
  | "guards"
  | "failures"
  | "skills"
  | "slashCommands"
  | "subagents"
  | "phrases"
  | "warnings"
  | "guardBlocks"
  | "outcome"
  | "sessionName"
  | "bare"
  | "main"
>;

/** A typed analysis as the scan reads it: the one cast stands for the fields the scan never reads. */
export function analysisOf(parts: Partial<Visible> = {}): SessionAnalysis {
  const visible: Visible = {
    guards: {},
    failures: [],
    skills: new Set(),
    slashCommands: [],
    subagents: [],
    phrases: [],
    warnings: [],
    guardBlocks: [],
    outcome: () => "heeded",
    sessionName: undefined,
    bare: { gh: 0, herdr: 0 },
    main: { pollMs: 0, reads: 0, signed: 0, raw: 0 },
    ...parts,
  };
  return visible as SessionAnalysis;
}

export const warning = (rule: string, line: number, glob = ""): Warning => ({
  rule,
  toolUseId: `t${line}`,
  line,
  excerpt: `ls ${line}`,
  glob,
});

export const at = (time: string) => `2026-11-03T${time}.000Z`;

export const sessions = new Map<
  string,
  { analysis: Partial<Visible>; first: string; last: string; skipped: number }
>();

/** Registers a session the mocks answer for: its analysis, first and last stamps, and skipped lines. */
export function add(
  id: string,
  analysis: Partial<Visible> = {},
  [first, last] = [at("10:00:00"), at("10:05:00")],
  skipped = 0,
) {
  sessions.set(id, { analysis, first, last, skipped });
}

/** Makes the mocked transcript and session units answer from the sessions registered with add(). */
export function wireSessions(): void {
  sessions.clear();
  vi.mocked(parseTranscript).mockImplementation((id) => ({
    id,
    events: [],
    skipped: sessions.get(id)?.skipped ?? 0,
  }));
  vi.mocked(timestamps).mockImplementation((session) => ({
    first: sessions.get(session.id)?.first ?? null,
    last: sessions.get(session.id)?.last ?? null,
  }));
  vi.mocked(SessionAnalysis).mockImplementation(function (session) {
    return analysisOf(sessions.get(session.id)?.analysis);
  });
}

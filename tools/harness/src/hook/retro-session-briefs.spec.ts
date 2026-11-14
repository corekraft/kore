// Whether one session counts a repeated prompt as a correction: an orchestrator brief never is, an untagged correction still is.
// Every transcript helper is mocked, so this covers the counting decision alone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionAnalysis } from "./retro-session.js";
import type { Transcript, TranscriptEvent } from "./retro-transcript.js";
import {
  blocksOf,
  callSignature,
  humanText,
  isOrchestratorBrief,
  ownWords,
  phrasesOf,
  readsAsCorrection,
  resultText,
  summarizeError,
} from "./retro-transcript.js";

vi.mock("./retro-transcript.js", () => ({
  blocksOf: vi.fn(),
  callSignature: vi.fn(),
  humanText: vi.fn(),
  isOrchestratorBrief: vi.fn(),
  ownWords: vi.fn(),
  phrasesOf: vi.fn(),
  readsAsCorrection: vi.fn(),
  resultText: vi.fn(),
  summarizeError: vi.fn(),
}));

const event = (line: number): TranscriptEvent => ({ line, type: "user" });

const session = (...texts: string[]): Transcript => ({
  id: "s",
  skipped: 0,
  events: texts.map((_text, index) => event(index + 1)),
});

describe("session analysis counts a repeated prompt as a correction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(blocksOf).mockReturnValue([]);
    vi.mocked(callSignature).mockReturnValue("");
    vi.mocked(resultText).mockReturnValue("");
    vi.mocked(summarizeError).mockReturnValue("");
    vi.mocked(ownWords).mockImplementation((text: string) => text);
    vi.mocked(phrasesOf).mockImplementation((text: string) => [text]);
  });

  it("does not count a message that reads as an orchestrator brief", () => {
    const brief = "[orchestrator] Stop editing the widget manifests directly";
    vi.mocked(humanText).mockReturnValue(brief);
    vi.mocked(isOrchestratorBrief).mockImplementation((text) =>
      text.startsWith("[orchestrator]"),
    );
    vi.mocked(readsAsCorrection).mockReturnValue(true);

    const analysis = new SessionAnalysis(session(brief));

    expect(analysis.phrases).toEqual([]);
  });

  it("still counts an untagged user correction", () => {
    const correction = "Stop editing the widget manifests directly";
    vi.mocked(humanText).mockReturnValue(correction);
    vi.mocked(isOrchestratorBrief).mockReturnValue(false);
    vi.mocked(readsAsCorrection).mockReturnValue(true);

    const analysis = new SessionAnalysis(session(correction));

    expect(analysis.phrases).toEqual([{ phrase: correction, line: 1 }]);
  });
});

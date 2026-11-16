// One session's main-session figures as a unit (#940): poll minutes from each foreground
// poll's own time, pane-result reads, signed sends and raw sends. The transcript
// helpers and the command classifier are mocked, so only SessionAnalysis runs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bareSends } from "./retro-bare.js";
import { mainCommand } from "./retro-main.js";
import {
  blocksOf,
  briefSessionName,
  humanText,
  type Block,
  type TranscriptEvent,
} from "./retro-transcript.js";
import { session } from "./retro-session-support.js";

vi.mock("./retro-transcript.js");
vi.mock("./retro-bare.js");
vi.mock("./retro-main.js");

const { SessionAnalysis } = await import("./retro-session.js");

const BRIEF = "Implement #940.\n\nYou are w1; your session name is w1.";

const NONE = { loop: false, prChecks: [], reads: 0, signed: 0, raw: 0 };

/** A Bash call the assistant makes at `at`, optionally in the background or a sidechain. */
const call = (
  line: number,
  id: string,
  command: string,
  at: string,
  extra: { background?: boolean; sidechain?: boolean } = {},
): TranscriptEvent => ({
  line,
  type: "assistant",
  timestamp: at,
  ...(extra.sidechain ? { isSidechain: true } : {}),
  message: {
    content: [
      {
        type: "tool_use",
        id,
        name: "Bash",
        input: {
          command,
          ...(extra.background ? { run_in_background: true } : {}),
        },
      },
    ],
  },
});

/** The result of a call, at `at`. */
const result = (line: number, id: string, at: string): TranscriptEvent => ({
  line,
  type: "user",
  timestamp: at,
  message: {
    content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
  },
});

const typed = (line: number): TranscriptEvent => ({
  line,
  type: "user",
  message: { content: "typed" },
});

beforeEach(() => {
  vi.mocked(blocksOf).mockImplementation(
    (event) => (event.message?.content as Block[] | undefined) ?? [],
  );
  vi.mocked(humanText).mockReturnValue(null);
  vi.mocked(briefSessionName).mockReturnValue(undefined);
  vi.mocked(mainCommand).mockReturnValue(NONE);
  vi.mocked(bareSends).mockReturnValue([]);
});

describe("session analysis: poll minutes are the foreground poll calls' own time", () => {
  it("counts a foreground sleep as the minutes it took, from its call to its result", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, loop: true });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "sleep 300", "2026-11-16T10:00:00.000Z"),
        result(2, "t1", "2026-11-16T10:05:00.000Z"),
      ]),
    );
    expect(found.main.pollMs).toBe(300_000);
  });

  it("leaves a background poll out of the minutes, because it does not hold the main session", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, loop: true });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "sleep 600", "2026-11-16T10:00:00.000Z", {
          background: true,
        }),
        result(2, "t1", "2026-11-16T10:10:00.000Z"),
      ]),
    );
    expect(found.main.pollMs).toBe(0);
  });

  it("counts no minutes for a poll whose result never arrived, rather than guessing", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, loop: true });
    const found = new SessionAnalysis(
      session([call(1, "t1", "sleep 300", "2026-11-16T10:00:00.000Z")]),
    );
    expect(found.main.pollMs).toBe(0);
  });
});

describe("session analysis: a raw gh pr checks is a poll only when its pull request repeats", () => {
  it("does not count one gh pr checks on a pull request as a poll", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, prChecks: ["812"] });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "gh pr checks 812", "2026-11-16T10:00:00.000Z"),
        result(2, "t1", "2026-11-16T10:01:00.000Z"),
      ]),
    );
    expect(found.main.pollMs).toBe(0);
  });

  it("counts every gh pr checks on a pull request the session checks more than once", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, prChecks: ["812"] });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "gh pr checks 812", "2026-11-16T10:00:00.000Z"),
        result(2, "t1", "2026-11-16T10:01:00.000Z"),
        call(3, "t2", "gh pr checks 812", "2026-11-16T10:02:00.000Z"),
        result(4, "t2", "2026-11-16T10:04:00.000Z"),
      ]),
    );
    expect(found.main.pollMs).toBe(60_000 + 120_000);
  });
});

describe("session analysis: reads and sends are the main session's own calls", () => {
  it("sums the reads, signed sends and raw sends of each Bash call", () => {
    vi.mocked(mainCommand).mockImplementation((command) => {
      if (command.startsWith("herdr agent read")) {
        return { ...NONE, reads: 1 };
      }
      if (command.startsWith("harness session send")) {
        return { ...NONE, signed: 1 };
      }
      return command.startsWith("herdr agent prompt")
        ? { ...NONE, raw: 1 }
        : NONE;
    });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "herdr agent read w3:p1", "2026-11-16T10:00:00.000Z"),
        call(2, "t2", "herdr agent read w3:p2", "2026-11-16T10:00:01.000Z"),
        call(
          3,
          "t3",
          "harness session send w3 --message go",
          "2026-11-16T10:00:02.000Z",
        ),
        call(
          4,
          "t4",
          "herdr agent prompt w3:p1 hi",
          "2026-11-16T10:00:03.000Z",
        ),
        call(5, "t5", "npm test", "2026-11-16T10:00:04.000Z"),
      ]),
    );
    expect(found.main).toEqual({ pollMs: 0, reads: 2, signed: 1, raw: 1 });
  });

  it("reads a background call's reads and sends, since those land the moment they run", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, reads: 1 });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "herdr pane read w3:p1", "2026-11-16T10:00:00.000Z", {
          background: true,
        }),
      ]),
    );
    expect(found.main.reads).toBe(1);
  });
});

describe("session analysis: only the main session's figures are kept", () => {
  it("reports all zeros for a role session, whose first typed message is its spawn brief", () => {
    vi.mocked(humanText).mockImplementation((event) =>
      event.line === 1 ? BRIEF : null,
    );
    vi.mocked(briefSessionName).mockReturnValue("w1");
    vi.mocked(mainCommand).mockReturnValue({
      loop: true,
      prChecks: [],
      reads: 2,
      signed: 1,
      raw: 1,
    });
    const found = new SessionAnalysis(
      session([
        typed(1),
        call(2, "t1", "sleep 300", "2026-11-16T10:00:00.000Z"),
        result(3, "t1", "2026-11-16T10:05:00.000Z"),
      ]),
    );
    expect(found.main).toEqual({ pollMs: 0, reads: 0, signed: 0, raw: 0 });
  });

  it("leaves a sidechain call out, since a subagent's Bash is not the main session typing", () => {
    vi.mocked(mainCommand).mockReturnValue({ ...NONE, reads: 1, raw: 1 });
    const found = new SessionAnalysis(
      session([
        call(1, "t1", "herdr agent read w3:p1", "2026-11-16T10:00:00.000Z", {
          sidechain: true,
        }),
      ]),
    );
    expect(found.main).toEqual({ pollMs: 0, reads: 0, signed: 0, raw: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { tickHeartbeat } from "../orchestrator/index.js";
import { signedBody } from "../sender/index.js";
import { DecisionError } from "./decision.js";
import {
  DIGEST_INTERVAL_MS,
  digestDue,
  postDigest,
  type DigestPorts,
} from "./digest.js";
import { openOwnerQuestions, type OwnerQuestion } from "./owner-queue.js";

vi.mock("../sender/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sender/index.js")>()),
  signedBody: vi.fn(),
}));
vi.mock("../orchestrator/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../orchestrator/index.js")>()),
  tickHeartbeat: vi.fn(),
}));
vi.mock("./owner-queue.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./owner-queue.js")>()),
  openOwnerQuestions: vi.fn(),
}));

const ENV = { KORE_ROLE: "advisor", KORE_AGENT: "advise-x" };
const NOW = new Date("2026-11-17T12:00:00.000Z");
const PINNED = { number: "900", repo: "corekraft/kore" };
const URL = "https://github.com/corekraft/kore/issues/900#c1";
const QUESTIONS: OwnerQuestion[] = [
  {
    idea: "0008",
    category: "destruction",
    since: "2026-11-17T10:00:00.000Z",
    blocking: true,
  },
  {
    idea: "0009",
    category: "credentials",
    since: "2026-11-17T11:00:00.000Z",
    blocking: false,
  },
];

function ports(overrides: Partial<DigestPorts> = {}): DigestPorts {
  return {
    env: ENV,
    flagOn: vi.fn(() => Promise.resolve(true)),
    pinned: vi.fn(() => Promise.resolve(PINNED)),
    post: vi.fn(() => Promise.resolve(URL)),
    record: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...overrides,
  };
}

function digestAt(at: string): LedgerEvent {
  return {
    schema: 1,
    id: "d",
    source: "claude",
    kind: "decision.digest",
    occurredAt: at,
    recordedAt: at,
  } as LedgerEvent;
}

beforeEach(() => {
  vi.mocked(signedBody).mockReturnValue({ body: "SIGNED DIGEST" });
  vi.mocked(openOwnerQuestions).mockReturnValue(QUESTIONS);
  vi.mocked(tickHeartbeat).mockReturnValue({
    state: "running",
    lastAt: NOW.toISOString(),
  });
});

describe("digestDue", () => {
  it("is due when no digest has been posted", () => {
    expect(digestDue([], NOW)).toBe(true);
  });

  it("is not due within a day of the last digest, and is due once a day has passed", () => {
    const last = "2026-11-16T12:30:00.000Z";

    expect(digestDue([digestAt(last)], NOW)).toBe(false);
    expect(
      digestDue(
        [digestAt(last)],
        new Date(Date.parse(last) + DIGEST_INTERVAL_MS),
      ),
    ).toBe(true);
  });
});

describe("postDigest", () => {
  it("does nothing, and reads no pinned issue, while the decision-advisor flag is off", async () => {
    const p = ports({ flagOn: vi.fn(() => Promise.resolve(false)) });

    await expect(postDigest(p, { events: [], now: NOW })).rejects.toThrow(
      /decision-advisor flag is off/,
    );

    expect(p.pinned).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("posts nothing before a day has passed since the last digest", async () => {
    const p = ports();
    const last = "2026-11-17T06:00:00.000Z";

    const result = await postDigest(p, {
      events: [digestAt(last)],
      now: NOW,
    });

    expect(result).toEqual({
      posted: false,
      reason: "not-due",
      nextAt: new Date(Date.parse(last) + DIGEST_INTERVAL_MS).toISOString(),
    });
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("posts nothing when no question is open and the tick is running", async () => {
    vi.mocked(openOwnerQuestions).mockReturnValue([]);
    const p = ports();

    const result = await postDigest(p, { events: [], now: NOW });

    expect(result).toEqual({ posted: false, reason: "nothing-to-report" });
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });
});

describe("postDigest posting", () => {
  it("posts the signed digest on the pinned issue, blocking questions first, and records decision.digest", async () => {
    const p = ports();

    const result = await postDigest(p, { events: [], now: NOW });

    expect(signedBody).toHaveBeenCalledWith(
      ENV,
      "decision digest",
      "Owner digest: 2 open reserved questions, 1 blocking.\n\nBlocking:\n- idea 0008 (destruction), asked 2026-11-17T10:00:00.000Z\n\nOpen:\n- idea 0009 (credentials), asked 2026-11-17T11:00:00.000Z",
    );
    expect(p.pinned).toHaveBeenCalled();
    expect(p.post).toHaveBeenCalledWith(PINNED, "SIGNED DIGEST");
    expect(p.record).toHaveBeenCalledWith(NOW.toISOString());
    expect(result).toEqual({
      posted: true,
      commentUrl: URL,
      open: 2,
      blocking: 1,
      tickGap: false,
    });
  });

  it("says the tick is not running in the digest, even with no open question", async () => {
    vi.mocked(openOwnerQuestions).mockReturnValue([]);
    vi.mocked(tickHeartbeat).mockReturnValue({
      state: "gap",
      lastAt: "2026-11-16T20:00:00.000Z",
    });

    await postDigest(ports(), { events: [], now: NOW });

    expect(signedBody).toHaveBeenCalledWith(
      ENV,
      "decision digest",
      "Owner digest: no open reserved questions.\n\nthe tick is not running: no heartbeat since 2026-11-16T20:00:00.000Z",
    );
  });
});

describe("postDigest refusals", () => {
  it("refuses with nothing posted when no issue is pinned, since the pinned read throws", async () => {
    const p = ports({
      pinned: vi.fn(() =>
        Promise.reject(
          new DecisionError("No issue is pinned. Pin one, then rerun."),
        ),
      ),
    });

    await expect(postDigest(p, { events: [], now: NOW })).rejects.toThrow(
      "No issue is pinned. Pin one, then rerun.",
    );

    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("refuses with nothing posted when the sender line cannot be written", async () => {
    vi.mocked(signedBody).mockReturnValue({ error: "no role" });
    const p = ports();

    await expect(postDigest(p, { events: [], now: NOW })).rejects.toThrow(
      DecisionError,
    );

    expect(p.post).not.toHaveBeenCalled();
  });

  it("names the posted comment and says not to post again when the ledger rejects decision.digest", async () => {
    const p = ports({
      record: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: "bad time." }),
      ),
    });

    await expect(postDigest(p, { events: [], now: NOW })).rejects.toThrow(
      `The digest was posted at ${URL}, but its ledger event was rejected: bad time. Do not post the digest again.`,
    );
  });
});

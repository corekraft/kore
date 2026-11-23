import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { pages } from "./github-gh.js";
import { readSender, type Sender } from "../sender/index.js";
import {
  decisionIssues,
  fromOverturns,
  overturnEvents,
} from "./github-overturns.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./github-gh.js", () => ({
  asRecord: (value: unknown) =>
    typeof value === "object" && value !== null ? value : {},
  when: (value: unknown) => (typeof value === "string" ? value : undefined),
  pages: vi.fn(),
}));
vi.mock("./github-owner-actions.js", () => ({
  APPROVED_MARKER: "<!-- harness:auto-approved -->",
  REFUSED_MARKER: "<!-- harness:left-for-person -->",
}));
vi.mock("../sender/index.js", () => ({ readSender: vi.fn() }));

const OWNER = "junners";
const REPO = "corekraft/kore";
const ISSUE = 862;

/** Comment bodies, keyed so the mocked sender reader can answer for each. */
const DECISION = "decision body";
const ADVISOR_OTHER_COMMAND = "advisor other body";
const WRITER = "writer body";
const PLAIN = "plain owner reply";
const APPROVED = "<!-- harness:auto-approved -->\nthe approval";

const ADVISOR: Sender = {
  command: "decision make",
  session: { role: "advisor", name: "advisor-862" },
};
const SENDERS = new Map<string, Sender>([
  [DECISION, ADVISOR],
  [
    ADVISOR_OTHER_COMMAND,
    {
      command: "decision ask",
      session: { role: "advisor", name: "advisor-862" },
    },
  ],
  [
    WRITER,
    { command: "review post", session: { role: "writer", name: "fix-x" } },
  ],
]);

/** One issue comment as GitHub lists it: an id, a body, a time and a login. */
function comment(
  id: number,
  body: string,
  at: string | undefined,
  login = OWNER,
) {
  return {
    id,
    body,
    created_at: at,
    user: { login },
  } as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(readSender).mockImplementation((body) => SENDERS.get(body));
});

describe("overturnEvents: the owner's reply to an advisor decision", () => {
  it("records the owner's first untagged reply after an advisor decision as advisor.overturned on its issue", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z", "harness-bot"),
        comment(2, PLAIN, "2026-11-16T11:00:00Z"),
      ],
      OWNER,
    );

    expect(events).toEqual([
      {
        id: "github:advisor.overturned:2",
        source: "github",
        kind: "advisor.overturned",
        occurredAt: "2026-11-16T11:00:00Z",
        number: 862,
        idea: "#862",
      },
    ]);
  });

  it("ignores a tagged reply, since a comment with a sender line is never the owner's", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
        comment(2, WRITER, "2026-11-16T11:00:00Z"),
      ],
      OWNER,
    );

    expect(events).toEqual([]);
  });

  it("ignores an untagged reply from another login", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
        comment(2, PLAIN, "2026-11-16T11:00:00Z", "someone-else"),
      ],
      OWNER,
    );

    expect(events).toEqual([]);
  });

  it("records nothing for an untagged reply with no advisor decision before it", () => {
    const events = overturnEvents(
      ISSUE,
      [comment(1, PLAIN, "2026-11-16T11:00:00Z")],
      OWNER,
    );

    expect(events).toEqual([]);
  });

  it("does not treat another advisor command as a decision", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, ADVISOR_OTHER_COMMAND, "2026-11-16T10:00:00Z"),
        comment(2, PLAIN, "2026-11-16T11:00:00Z"),
      ],
      OWNER,
    );

    expect(events).toEqual([]);
  });
});

describe("overturnEvents: one overturn per decision", () => {
  it("counts one overturn per decision, so a second untagged reply after it is not recorded", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
        comment(2, PLAIN, "2026-11-16T11:00:00Z"),
        comment(3, PLAIN, "2026-11-16T12:00:00Z"),
      ],
      OWNER,
    );

    expect(events.map((e) => e.id)).toEqual(["github:advisor.overturned:2"]);
  });

  it("opens the question again at a later decision, so each decision has its own overturn", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
        comment(2, PLAIN, "2026-11-16T11:00:00Z"),
        comment(3, DECISION, "2026-11-16T12:00:00Z"),
        comment(4, PLAIN, "2026-11-16T13:00:00Z"),
      ],
      OWNER,
    );

    expect(events.map((e) => e.id)).toEqual([
      "github:advisor.overturned:2",
      "github:advisor.overturned:4",
    ]);
  });

  it("reads the comments in time order, whatever order GitHub listed them in", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(2, PLAIN, "2026-11-16T11:00:00Z"),
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
      ],
      OWNER,
    );

    expect(events.map((e) => e.id)).toEqual(["github:advisor.overturned:2"]);
  });
});

describe("overturnEvents: what is never counted", () => {
  it("never records the harness approval marker as the owner's reply, since the agent posts it under the owner's login", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
        comment(2, APPROVED, "2026-11-16T11:00:00Z"),
      ],
      OWNER,
    );

    expect(events).toEqual([]);
  });

  it("records nothing for a reply whose time GitHub did not give", () => {
    const events = overturnEvents(
      ISSUE,
      [
        comment(1, DECISION, "2026-11-16T10:00:00Z"),
        comment(2, PLAIN, undefined),
      ],
      OWNER,
    );

    expect(events).toEqual([]);
  });
});

describe("fromOverturns: reading the comments of each decision's issue", () => {
  it("lists each decision issue's comments and returns what they record", async () => {
    vi.mocked(pages).mockResolvedValue([
      comment(1, DECISION, "2026-11-16T10:00:00Z"),
      comment(2, PLAIN, "2026-11-16T11:00:00Z"),
    ]);

    const events = await fromOverturns({} as Runner, REPO, OWNER, [ISSUE]);

    expect(pages).toHaveBeenCalledWith(
      {},
      "api issues/862/comments",
      "repos/corekraft/kore/issues/862/comments",
    );
    expect(events).toEqual([
      expect.objectContaining({ id: "github:advisor.overturned:2" }),
    ]);
  });

  it("returns the message of a listing that failed, so the poll fails with its cause", async () => {
    vi.mocked(pages).mockResolvedValue(
      "gh api issues/862/comments failed: boom",
    );

    const events = await fromOverturns({} as Runner, REPO, OWNER, [ISSUE]);

    expect(events).toBe("gh api issues/862/comments failed: boom");
  });

  it("reads nothing when no decision was made", async () => {
    const events = await fromOverturns({} as Runner, REPO, OWNER, []);

    expect(pages).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("decisionIssues: which issues a decision was recorded on", () => {
  it("names each decided issue once, by its issue number, in the order first seen", () => {
    expect(
      decisionIssues([{ number: 862 }, { number: 7 }, { number: 862 }]),
    ).toEqual([862, 7]);
  });

  it("skips a decision recorded before it carried its issue number, since there is no issue to read", () => {
    expect(decisionIssues([{}, { number: 7 }])).toEqual([7]);
  });
});

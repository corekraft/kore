import { beforeEach, describe, expect, it, vi } from "vitest";
import { signedBody } from "../sender/index.js";
import { DecisionError, makeDecision, type DecisionPorts } from "./decision.js";
import { reservedCategory } from "./reserved.js";

vi.mock("../sender/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sender/index.js")>()),
  signedBody: vi.fn(),
}));
vi.mock("./reserved.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reserved.js")>()),
  reservedCategory: vi.fn(),
}));

const ENV = { KORE_ROLE: "advisor", KORE_AGENT: "advise-x" };
const INPUT = {
  idea: "0008",
  category: "naming",
  question: "Name the column Median or P50?",
  decision: "Median, as the report already says.",
};
const TARGET = { idea: "0008", number: "795", repo: "corekraft/kore" };
const ISSUE_TARGET = { number: "1435", repo: "corekraft/kore" };
const ISSUE_URL = "https://github.com/corekraft/kore/issues/1435";
const ISSUE_INPUT = {
  issue: "1435",
  category: "naming",
  question: "Name the column Median or P50?",
  decision: "Median, as the report already says.",
};
const COMMENT = "https://github.com/corekraft/kore/issues/795#c1";

function ports(overrides: Partial<DecisionPorts> = {}): DecisionPorts {
  return {
    env: ENV,
    flagOn: vi.fn(() => Promise.resolve(true)),
    target: vi.fn(() => Promise.resolve(TARGET)),
    issue: vi.fn(() => Promise.resolve(ISSUE_TARGET)),
    post: vi.fn(() => Promise.resolve(COMMENT)),
    record: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(reservedCategory).mockReturnValue(undefined);
  vi.mocked(signedBody).mockReturnValue({ body: "SIGNED BODY" });
});

describe("makeDecision", () => {
  it("posts the signed decision on the idea's issue and records decision.made with the idea, its issue number and category only", async () => {
    const p = ports();

    const made = await makeDecision(p, INPUT);

    expect(signedBody).toHaveBeenCalledWith(
      ENV,
      "decision make",
      "Decision (naming)\n\nQuestion: Name the column Median or P50?\n\nDecision: Median, as the report already says.",
    );
    expect(p.post).toHaveBeenCalledWith(TARGET, "SIGNED BODY");
    expect(p.record).toHaveBeenCalledWith({
      idea: "0008",
      label: "naming",
      number: 795,
    });
    expect(made).toEqual({
      idea: "0008",
      category: "naming",
      issue: "https://github.com/corekraft/kore/issues/795",
      commentUrl: COMMENT,
    });
  });

  it("does nothing while the decision-advisor flag is off", async () => {
    const p = ports({ flagOn: vi.fn(() => Promise.resolve(false)) });

    await expect(makeDecision(p, INPUT)).rejects.toThrow(
      /decision-advisor flag is off/,
    );

    expect(p.target).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("refuses a question that matches the reserved list, posting and recording nothing", async () => {
    vi.mocked(reservedCategory).mockReturnValue("destruction");
    const p = ports();

    const refusal = makeDecision(p, INPUT);

    await expect(refusal).rejects.toThrow(DecisionError);
    await expect(refusal).rejects.toThrow(
      /matches the reserved category "destruction".*belongs to the owner/s,
    );
    expect(reservedCategory).toHaveBeenCalledWith(INPUT.question);
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("refuses a declared category that names a reserved one", async () => {
    vi.mocked(reservedCategory).mockImplementation((text) =>
      text === "credentials" ? "credentials" : undefined,
    );
    const p = ports();

    await expect(
      makeDecision(p, { ...INPUT, category: "credentials" }),
    ).rejects.toThrow(/category "credentials" is reserved/);

    expect(p.post).not.toHaveBeenCalled();
  });
});

describe("makeDecision for a plain ticket", () => {
  it("posts on the ticket's issue and records decision.made with the issue number and category, never an idea", async () => {
    const p = ports();

    const made = await makeDecision(p, ISSUE_INPUT);

    expect(p.issue).toHaveBeenCalledWith("1435");
    expect(p.target).not.toHaveBeenCalled();
    expect(p.post).toHaveBeenCalledWith(ISSUE_TARGET, "SIGNED BODY");
    const recorded = vi.mocked(p.record).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(recorded).toEqual({ label: "naming", number: 1435 });
    expect("idea" in recorded).toBe(false);
    expect(made).toEqual({
      category: "naming",
      issue: ISSUE_URL,
      commentUrl: COMMENT,
    });
    expect("idea" in made).toBe(false);
  });
});

describe("makeDecision refusals for a plain ticket", () => {
  it("refuses an input with neither --idea nor --issue, posting and recording nothing", async () => {
    const p = ports();

    await expect(
      makeDecision(p, { category: "naming", question: "Q?", decision: "D." }),
    ).rejects.toThrow(/exactly one of --idea and --issue/);

    expect(p.target).not.toHaveBeenCalled();
    expect(p.issue).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("refuses an input with both --idea and --issue, posting and recording nothing", async () => {
    const p = ports();

    await expect(makeDecision(p, { ...INPUT, issue: "1435" })).rejects.toThrow(
      /exactly one of --idea and --issue/,
    );

    expect(p.target).not.toHaveBeenCalled();
    expect(p.issue).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "1435a", "#1435"])(
    "refuses --issue %j, which is not an issue number, posting nothing",
    async (issue) => {
      const p = ports();

      await expect(makeDecision(p, { ...ISSUE_INPUT, issue })).rejects.toThrow(
        /--issue/,
      );

      expect(p.issue).not.toHaveBeenCalled();
      expect(p.post).not.toHaveBeenCalled();
    },
  );

  it("refuses a reserved question on a ticket too, posting and recording nothing", async () => {
    vi.mocked(reservedCategory).mockReturnValue("destruction");
    const p = ports();

    await expect(makeDecision(p, ISSUE_INPUT)).rejects.toThrow(
      /matches the reserved category "destruction"/,
    );

    expect(p.issue).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("names the issue number to record by hand when the ledger rejects the event afterwards", async () => {
    const p = ports({
      record: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: "ledger is full" }),
      ),
    });

    await expect(makeDecision(p, ISSUE_INPUT)).rejects.toThrow(
      `The decision was posted at ${COMMENT}, but its ledger event was rejected: ledger is full Record it with \`harness ledger record --source claude --kind decision.made --number 1435 --label naming --occurred-at <now, ISO 8601 UTC>\`; do not post the decision again.`,
    );
  });
});

describe("makeDecision refusals before anything is posted", () => {
  it.each(["", "Naming", "two words", "-lead"])(
    "refuses the category %j, which a ledger label cannot safely carry",
    async (category) => {
      const p = ports();

      await expect(makeDecision(p, { ...INPUT, category })).rejects.toThrow(
        /--category/,
      );

      expect(p.post).not.toHaveBeenCalled();
    },
  );

  it.each(["question", "decision"] as const)(
    "refuses an empty %s",
    async (field) => {
      const p = ports();

      await expect(
        makeDecision(p, { ...INPUT, [field]: "  " }),
      ).rejects.toThrow(new RegExp(`--${field}`));

      expect(p.post).not.toHaveBeenCalled();
    },
  );

  it("posts nothing when the sender line cannot be written", async () => {
    vi.mocked(signedBody).mockReturnValue({ error: "no session name" });
    const p = ports();

    await expect(makeDecision(p, INPUT)).rejects.toThrow("no session name");

    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("names the posted comment when the ledger rejects the event afterwards", async () => {
    const p = ports({
      record: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: "ledger is full" }),
      ),
    });

    await expect(makeDecision(p, INPUT)).rejects.toThrow(
      `The decision was posted at ${COMMENT}, but its ledger event was rejected: ledger is full Record it with \`harness ledger record --source claude --kind decision.made --idea 0008 --label naming --occurred-at <now, ISO 8601 UTC>\`; do not post the decision again.`,
    );
  });
});

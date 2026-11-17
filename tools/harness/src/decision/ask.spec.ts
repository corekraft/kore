import { beforeEach, describe, expect, it, vi } from "vitest";
import { signedBody } from "../sender/index.js";
import { DecisionError, type DecisionTarget } from "./decision.js";
import { askOwner, ASK_LABEL, type AskPorts } from "./ask.js";
import { classify } from "./route.js";
import { reservedCategory } from "./reserved.js";

vi.mock("../sender/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sender/index.js")>()),
  signedBody: vi.fn(),
}));
vi.mock("./reserved.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reserved.js")>()),
  reservedCategory: vi.fn(),
}));
vi.mock("./route.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./route.js")>()),
  classify: vi.fn(),
}));

const ENV = { KORE_ROLE: "writer", KORE_AGENT: "writer-x" };
const INPUT = {
  idea: "0008",
  category: "credentials",
  question: "Which token should the digest use?",
  action: "Store the new token in the local overlay.",
};
const TARGET: DecisionTarget = {
  idea: "0008",
  number: "878",
  repo: "corekraft/kore",
};
const COMMENT = "https://github.com/corekraft/kore/issues/878#c2";

function ports(overrides: Partial<AskPorts> = {}): AskPorts {
  return {
    env: ENV,
    flagOn: vi.fn(() => Promise.resolve(true)),
    target: vi.fn(() => Promise.resolve(TARGET)),
    label: vi.fn(() => Promise.resolve()),
    post: vi.fn(() => Promise.resolve(COMMENT)),
    record: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(reservedCategory).mockReturnValue(undefined);
  vi.mocked(classify).mockReturnValue({
    route: "owner",
    signal: "reserved-category",
  });
  vi.mocked(signedBody).mockReturnValue({ body: "SIGNED QUESTION" });
});

describe("askOwner", () => {
  it("labels the issue, posts the signed question there, and records decision.routed to the owner", async () => {
    const p = ports();

    const asked = await askOwner(p, INPUT);

    expect(ASK_LABEL).toBe("needs-info");
    expect(p.label).toHaveBeenCalledWith(TARGET, "needs-info");
    expect(signedBody).toHaveBeenCalledWith(
      ENV,
      "decision ask",
      "Question for the owner (credentials): Which token should the digest use?\n\nProposed action: Store the new token in the local overlay.\n\nAnswer with a plain comment on this issue.",
    );
    expect(p.post).toHaveBeenCalledWith(TARGET, "SIGNED QUESTION");
    expect(p.record).toHaveBeenCalledWith({
      idea: "0008",
      label: "credentials",
      route: "owner",
      signal: "reserved-category",
    });
    expect(vi.mocked(p.label).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(p.post).mock.invocationCallOrder[0] as number,
    );
    expect(asked).toEqual({
      idea: "0008",
      category: "credentials",
      issue: "https://github.com/corekraft/kore/issues/878",
      commentUrl: COMMENT,
      signal: "reserved-category",
    });
  });

  it("does nothing while the decision-advisor flag is off", async () => {
    const p = ports({ flagOn: vi.fn(() => Promise.resolve(false)) });

    await expect(askOwner(p, INPUT)).rejects.toThrow(
      /decision-advisor flag is off/,
    );

    expect(p.target).not.toHaveBeenCalled();
    expect(p.label).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("never routes a consent prompt for a destructive command, and posts nothing", async () => {
    vi.mocked(reservedCategory).mockImplementation((text) =>
      text === "Delete the stale release branch." ? "destruction" : undefined,
    );
    const p = ports();

    await expect(
      askOwner(p, { ...INPUT, action: "Delete the stale release branch." }),
    ).rejects.toThrow(/consent for a destructive command is never routed/);

    expect(p.label).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });
});

describe("askOwner refusals", () => {
  it("refuses a question the advisor decides, posting nothing, so it goes to decision make", async () => {
    vi.mocked(classify).mockReturnValue({ route: "advisor", signal: "agreed" });
    const p = ports();

    await expect(askOwner(p, INPUT)).rejects.toThrow(
      /is the advisor's, so it is not posted/,
    );

    expect(p.label).not.toHaveBeenCalled();
    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("refuses an empty question, and a category name that is not one", async () => {
    const p = ports();

    await expect(askOwner(p, { ...INPUT, question: "  " })).rejects.toThrow(
      DecisionError,
    );
    await expect(
      askOwner(p, { ...INPUT, category: "Bad Name" }),
    ).rejects.toThrow(DecisionError);

    expect(p.post).not.toHaveBeenCalled();
  });

  it("refuses with nothing posted when the sender line cannot be written", async () => {
    vi.mocked(signedBody).mockReturnValue({ error: "no role on this pane." });
    const p = ports();

    await expect(askOwner(p, INPUT)).rejects.toThrow("no role on this pane.");

    expect(p.post).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("names the posted comment and says not to ask again when the ledger rejects decision.routed", async () => {
    const p = ports({
      record: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: "bad time." }),
      ),
    });

    await expect(askOwner(p, INPUT)).rejects.toThrow(
      `The question was posted at ${COMMENT}, but its route was not recorded: bad time. Do not ask the owner again.`,
    );
  });
});

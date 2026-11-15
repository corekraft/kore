// The guardrail request unit: posts one approval request per change on the idea's
// issue and records it. Every port is a mock; the evidence unit is a mock too.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestEvidence, type Evidence } from "./evidence.js";
import { GuardrailError, type Inventory } from "./inventory.js";
import { GuardrailRequest, type RequestPorts } from "./request.js";

vi.mock("./evidence.js");

const INVENTORY: Inventory = {
  guardrails: [
    { rule: "bare-glob", kind: "bash", mode: "audit", owner: "o" },
    { rule: "no-verify", kind: "bash", mode: "enforce", owner: "o" },
  ],
};
const EVIDENCE: Evidence = {
  fired: 6,
  heeded: 6,
  overridden: 0,
  falsePositives: 0,
  classification: "promotable",
};
const IDEA = {
  number: "0223",
  title: "Guardrail approval",
  path: "docs/ideas/0223-guardrail-approval.md",
  issue: "223",
};

function fake(idea: RequestPorts["idea"] = IDEA) {
  const events = vi.fn<RequestPorts["events"]>().mockResolvedValue([]);
  const recordEvent = vi
    .fn<RequestPorts["recordEvent"]>()
    .mockResolvedValue({ ok: true });
  const comments = vi.fn<RequestPorts["comments"]>().mockResolvedValue([]);
  const comment = vi
    .fn<RequestPorts["comment"]>()
    .mockResolvedValue("https://github.com/o/r/issues/223#c1");
  const ports: RequestPorts = {
    inventory: INVENTORY,
    idea,
    repo: "o/r",
    events,
    recordEvent,
    comments,
    comment,
  };
  return {
    request: new GuardrailRequest(ports),
    events,
    recordEvent,
    comments,
    comment,
  };
}

const input = (rule = "bare-glob", to = "enforce") => ({
  rule,
  to,
  falsePositives: 0,
  scan: { scan: true },
});

beforeEach(() => {
  vi.mocked(requestEvidence).mockReturnValue(EVIDENCE);
});

describe("posting a request", () => {
  it("posts the idea link and the four figures on the idea's issue, then records the request", async () => {
    const { request, comment, recordEvent } = fake();
    const done = await request.request(input());
    expect(comment).toHaveBeenCalledOnce();
    const [issue, body] = comment.mock.calls[0] ?? [];
    expect(issue).toBe("223");
    expect(body).toBe(
      [
        "<!-- guardrail-request: bare-glob:audit>enforce -->",
        "### Request to enforce guardrail `bare-glob`",
        "",
        "Change: audit to enforce",
        "Idea: https://github.com/o/r/blob/main/docs/ideas/0223-guardrail-approval.md (Guardrail approval)",
        "",
        "- Fired: 6",
        "- Heeded: 6",
        "- Overridden: 0",
        "- False positives: 0",
        "- Classification: promotable",
        "",
        "A person approves this. The request changes no mode.",
      ].join("\n"),
    );
    expect(recordEvent.mock.calls).toEqual([
      ["bare-glob:audit>enforce", "0223"],
    ]);
    expect(done).toEqual({
      rule: "bare-glob",
      from: "audit",
      to: "enforce",
      idea: "0223",
      issue: "223",
      evidence: EVIDENCE,
      posted: true,
      recorded: true,
      commentUrl: "https://github.com/o/r/issues/223#c1",
    });
  });

  it("asks for evidence by the rule's current mode in the inventory", async () => {
    const { request } = fake();
    await request.request({
      ...input("no-verify", "audit"),
      falsePositives: 2,
    });
    expect(vi.mocked(requestEvidence).mock.calls).toEqual([
      [{ scan: true }, "no-verify", "enforce", 2],
    ]);
  });
});

describe("requesting a loosening", () => {
  it("files a loosening (enforce to audit) and a removal the same way as a tightening", async () => {
    const loosen = fake();
    await loosen.request.request(input("no-verify", "audit"));
    const removal = fake();
    await removal.request.request(input("no-verify", "removed"));
    expect(loosen.comment.mock.calls[0]?.[1]).toContain(
      "### Request to loosen guardrail `no-verify`",
    );
    expect(removal.comment.mock.calls[0]?.[1]).toContain(
      "### Request to remove guardrail `no-verify`",
    );
    expect(removal.recordEvent.mock.calls).toEqual([
      ["no-verify:enforce>removed", "0223"],
    ]);
  });

  it("prints a figure the scan cannot measure as not measured", async () => {
    vi.mocked(requestEvidence).mockReturnValue({
      fired: 3,
      heeded: null,
      overridden: null,
      falsePositives: 1,
      classification: null,
    });
    const { request, comment } = fake();
    await request.request(input("no-verify", "audit"));
    expect(comment.mock.calls[0]?.[1]).toContain(
      "- Fired: 3\n- Heeded: not measured\n- Overridden: not measured\n- False positives: 1\n",
    );
  });
});

describe("never posting twice", () => {
  it("posts nothing and records nothing when the ledger already holds the request", async () => {
    const { request, events, comment, comments, recordEvent } = fake();
    events.mockResolvedValue([{ label: "bare-glob:audit>enforce" }]);
    const done = await request.request(input());
    expect(comment).not.toHaveBeenCalled();
    expect(comments).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
    expect(done).toMatchObject({ posted: false, recorded: false });
  });

  it("records without posting when the comment is already on the issue but the ledger lacks it", async () => {
    const { request, comments, comment, recordEvent } = fake();
    comments.mockResolvedValue([
      "<!-- guardrail-request: bare-glob:audit>enforce -->\nbody",
    ]);
    const done = await request.request(input());
    expect(comment).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledOnce();
    expect(done).toMatchObject({ posted: false, recorded: true });
  });

  it("posts again for a different change to the same rule", async () => {
    const { request, events, comment } = fake();
    events.mockResolvedValue([{ label: "bare-glob:audit>removed" }]);
    await request.request(input());
    expect(comment).toHaveBeenCalledOnce();
  });
});

describe("refusing before anything is posted", () => {
  async function refused(
    f: ReturnType<typeof fake>,
    given = input(),
  ): Promise<string> {
    const error = await f.request.request(given).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GuardrailError);
    expect(f.comment).not.toHaveBeenCalled();
    expect(f.recordEvent).not.toHaveBeenCalled();
    return (error as Error).message;
  }

  it("names the missing evidence and posts nothing", async () => {
    vi.mocked(requestEvidence).mockImplementation(() => {
      throw new GuardrailError("no evidence");
    });
    expect(await refused(fake())).toBe("no evidence");
  });

  it("says to link an issue when the idea has none", async () => {
    const message = await refused(
      fake({ number: IDEA.number, title: IDEA.title, path: IDEA.path }),
    );
    expect(message).toBe(
      "Idea 0223 has no issue, so there is nowhere to ask for approval. Open one with `harness idea sync`, then rerun.",
    );
  });

  it("refuses a rule that is not in the inventory", async () => {
    expect(await refused(fake(), input("ghost"))).toBe(
      'No guardrail "ghost" in .claude/guardrails.yaml. Run `harness guardrail status` for the rule names.',
    );
  });

  it("refuses a change to the mode the rule already has", async () => {
    expect(await refused(fake(), input("bare-glob", "audit"))).toBe(
      'Guardrail "bare-glob" is already in audit mode. Pick enforce or removed.',
    );
  });

  it("refuses a target that is not enforce, audit or removed", async () => {
    expect(await refused(fake(), input("bare-glob", "off"))).toBe(
      'Unknown target "off". Use enforce, audit or removed.',
    );
  });
});

describe("a request never changes a mode", () => {
  it("leaves the inventory it was given untouched", async () => {
    const before = JSON.stringify(INVENTORY);
    await fake().request.request(input());
    expect(JSON.stringify(INVENTORY)).toBe(before);
  });
});

describe("a ledger that rejects the event", () => {
  it("fails after posting, naming the rerun that repairs it without a second comment", async () => {
    const { request, recordEvent } = fake();
    recordEvent.mockResolvedValue({ ok: false, message: "bad label" });
    await expect(request.request(input())).rejects.toThrow(
      "The request was posted, but its ledger event was rejected: bad label. Fix the ledger, then rerun the same command; it will not post again.",
    );
  });
});

import { describe, expect, it } from "vitest";
import { KINDS, parseEvent } from "./schema.js";

const linked = {
  source: "herdr",
  kind: "pr.linked",
  occurredAt: "2026-11-17T10:00:00.000Z",
  number: 9,
  session: "fix-x",
  agent: "fix-x",
};

describe("ledger event schema, pr.linked", () => {
  it("is a kind the ledger offers", () => {
    expect(KINDS).toContain("pr.linked");
  });

  it("accepts the pull request number with the writer's session name and agent, and nothing else", () => {
    expect(parseEvent(linked, "input")).toEqual({ ok: true, event: linked });
  });

  it("requires the pull request number it links", () => {
    const { number: _number, ...withoutNumber } = linked;
    expect(parseEvent(withoutNumber, "input")).toEqual({
      ok: false,
      field: "number",
      message: 'Invalid event: field "number" is required on pr.linked events.',
    });
  });

  it("refuses a pull request number that is not a positive integer", () => {
    expect(parseEvent({ ...linked, number: 0 }, "input")).toEqual({
      ok: false,
      field: "number",
      message: 'Invalid event: field "number" must be a positive integer.',
    });
  });

  it("requires the writer's session name", () => {
    const { session: _session, ...withoutSession } = linked;
    expect(parseEvent(withoutSession, "input")).toEqual({
      ok: false,
      field: "session",
      message:
        'Invalid event: field "session" is required on pr.linked events.',
    });
  });

  it("requires the writer's agent", () => {
    const { agent: _agent, ...withoutAgent } = linked;
    expect(parseEvent(withoutAgent, "input")).toEqual({
      ok: false,
      field: "agent",
      message: 'Invalid event: field "agent" is required on pr.linked events.',
    });
  });

  it("refuses a title or body field, which the ledger never stores", () => {
    expect(
      parseEvent({ ...linked, title: "feat: add pr open" }, "input"),
    ).toEqual({
      ok: false,
      field: "title",
      message:
        'Invalid event: field "title" is not a ledger field and is never stored.',
    });
  });

  it("does not require a session or agent on a kind that does not link a pull request", () => {
    const merged = {
      source: "github",
      kind: "pr.merged",
      occurredAt: "2026-11-17T10:00:00.000Z",
      number: 9,
    };
    expect(parseEvent(merged, "input")).toEqual({ ok: true, event: merged });
  });
});

describe("ledger event schema, pr.linked records the idea the pull request serves", () => {
  it("accepts the idea the pull request serves, or an explicit none, beside the writer's session and agent", () => {
    expect(parseEvent({ ...linked, idea: "0030" }, "input")).toEqual({
      ok: true,
      event: { ...linked, idea: "0030" },
    });
    expect(parseEvent({ ...linked, idea: "none" }, "input")).toEqual({
      ok: true,
      event: { ...linked, idea: "none" },
    });
  });

  it("refuses an idea that is not a name, such as one with a space in it", () => {
    expect(parseEvent({ ...linked, idea: "fix the thing" }, "input")).toEqual({
      ok: false,
      field: "idea",
      message:
        'Invalid event: field "idea" must be 1-128 letters, digits or . _ : / # @ -.',
    });
  });

  it("still reads a stored link event from before the idea was recorded, with no idea", () => {
    const stored = {
      schema: 1,
      id: "id-1",
      recordedAt: "2026-11-17T10:00:00.000Z",
      ...linked,
    };
    expect(parseEvent(stored, "stored")).toEqual({ ok: true, event: stored });
  });
});

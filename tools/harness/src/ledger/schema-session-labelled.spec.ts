import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "herdr", occurredAt: "2026-11-17T10:00:00.000Z" };
const labelled = {
  ...stamp,
  kind: "session.labelled",
  session: "launch-labels-ledger",
  label: "ready-for-agent",
};

describe("session.labelled events", () => {
  it("are a kind a tool records, never one only the poller writes", () => {
    expect(KINDS).toContain("session.labelled");
    expect(POLLER_KINDS).not.toContain("session.labelled");
  });

  it("records one label of the issue a writer's session works, keyed by the session", () => {
    expect(parseEvent(labelled, "input")).toEqual({
      ok: true,
      event: labelled,
    });
  });

  it("requires the label, since each event carries exactly one", () => {
    const { label: _label, ...withoutLabel } = labelled;

    expect(parseEvent(withoutLabel, "input")).toMatchObject({
      ok: false,
      field: "label",
    });
  });

  it("refuses a label longer than 100 characters, so the ledger never drops it silently", () => {
    expect(
      parseEvent({ ...labelled, label: "x".repeat(101) }, "input"),
    ).toMatchObject({ ok: false, field: "label" });
  });
});

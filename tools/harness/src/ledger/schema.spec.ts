import { describe, expect, it } from "vitest";
import { KINDS, SOURCES, parseEvent } from "./schema.js";

const base = {
  source: "claude",
  kind: "session.start",
  occurredAt: "2026-01-02T03:04:05.000Z",
};

function rejected(input: unknown, mode: "input" | "stored" = "input") {
  const result = parseEvent(input, mode);
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("ledger event schema", () => {
  it("accepts a closed issue and requires its number", () => {
    const closed = { ...base, source: "github", kind: "issue.closed" };
    expect(rejected(closed).field).toBe("number");
    expect(parseEvent({ ...closed, number: 7 }, "input").ok).toBe(true);
  });

  it("accepts an outcome event with its label and issue number, and requires both", () => {
    const outcome = { ...base, source: "github", kind: "outcome" };
    expect(rejected(outcome).field).toBe("label");
    expect(rejected({ ...outcome, label: "outcome:refuted" }).field).toBe(
      "number",
    );
    expect(
      parseEvent(
        { ...outcome, idea: "0001", label: "outcome:refuted", number: 7 },
        "input",
      ).ok,
    ).toBe(true);
    expect(KINDS).toContain("outcome");
  });
});

describe("ledger event schema flag activation", () => {
  it("accepts a flag activation event with its flag and environment label, and requires it", () => {
    const activation = { ...base, source: "claude", kind: "flag.activated" };
    expect(rejected(activation).field).toBe("label");
    expect(
      parseEvent(
        { ...activation, label: "ingress-agentgateway@local" },
        "input",
      ).ok,
    ).toBe(true);
    expect(KINDS).toContain("flag.activated");
  });

  it("accepts a minimal event and keeps only the fields it was given", () => {
    const result = parseEvent(base, "input");
    expect(result).toEqual({ ok: true, event: base });
  });

  it("accepts every optional field on a tool end event", () => {
    const full = {
      ...base,
      id: "evt-1",
      kind: "tool.end",
      session: "s1",
      pane: "w3:p1",
      agent: "writer",
      idea: "0042-faster-loop",
      stage: "implement",
      tool: "Bash",
      outcome: "failure",
    };
    expect(parseEvent(full, "input")).toEqual({ ok: true, event: full });
  });

  it("accepts a label on issue.labelled and a number on issue and PR events", () => {
    const labelled = {
      source: "github",
      kind: "issue.labelled",
      occurredAt: "2026-01-02T03:04:05Z",
      label: "ready-for-agent",
      number: 142,
    };
    expect(parseEvent(labelled, "input")).toEqual({
      ok: true,
      event: labelled,
    });
  });

  it.each([...SOURCES])("accepts source %s", (source) => {
    expect(parseEvent({ ...base, source }, "input").ok).toBe(true);
  });

  it("offers a closed set of kinds", () => {
    expect(KINDS).toContain("session.start");
    expect(KINDS).toContain("pr.merged");
    expect(new Set(KINDS).size).toBe(KINDS.length);
  });
});

describe("ledger event schema rejections", () => {
  it.each([
    [{ ...base, kind: "session.explode" }, "kind"],
    [{ ...base, source: "slack" }, "source"],
    [{ ...base, source: undefined }, "source"],
    [{ ...base, kind: undefined }, "kind"],
    [{ ...base, occurredAt: undefined }, "occurredAt"],
    [{ ...base, occurredAt: "2026-01-02 03:04:05" }, "occurredAt"],
    [{ ...base, occurredAt: "2026-01-02T03:04:05+02:00" }, "occurredAt"],
    [{ ...base, occurredAt: "2026-02-31T03:04:05Z" }, "occurredAt"],
    [{ ...base, session: "" }, "session"],
    [{ ...base, session: 7 }, "session"],
    [{ ...base, pane: "has space" }, "pane"],
    [{ ...base, agent: "x".repeat(200) }, "agent"],
    [{ ...base, idea: null }, "idea"],
    [{ ...base, stage: "line\nbreak" }, "stage"],
    [{ ...base, id: "" }, "id"],
    [{ ...base, kind: "tool.start" }, "tool"],
    [{ ...base, kind: "tool.start", tool: "has space" }, "tool"],
    [{ ...base, kind: "tool.end", tool: "Bash" }, "outcome"],
    [{ ...base, kind: "tool.end", tool: "Bash", outcome: "meh" }, "outcome"],
    [{ ...base, kind: "issue.labelled", number: 1 }, "label"],
    [{ ...base, kind: "issue.opened" }, "number"],
    [{ ...base, kind: "pr.merged", number: 0 }, "number"],
    [{ ...base, kind: "pr.opened", number: 1.5 }, "number"],
    [{ ...base, kind: "pr.opened", number: "12" }, "number"],
    [{ ...base, tool: "Bash" }, "tool"],
    [{ ...base, outcome: "success" }, "outcome"],
    [{ ...base, label: "x" }, "label"],
    [{ ...base, number: 3 }, "number"],
    [{ ...base, recordedAt: "2026-01-02T03:04:05.000Z" }, "recordedAt"],
  ])("rejects %j naming the field %s", (input, field) => {
    const result = rejected(input);
    expect(result.field).toBe(field);
    expect(result.message).toContain(`"${field}"`);
  });

  it.each(["prompt", "toolInput", "toolOutput", "content", "cwd"])(
    "refuses to store a %s field",
    (field) => {
      const result = rejected({ ...base, [field]: "secret" });
      expect(result.field).toBe(field);
      expect(result.message).toMatch(/not a ledger field/);
    },
  );

  it.each([null, "text", 7, [], undefined])(
    "rejects a non-object event %j",
    (input) => {
      expect(rejected(input).field).toBe("event");
    },
  );
});

describe("ledger event schema, stored events", () => {
  it("requires recordedAt and the schema version on a stored event", () => {
    const stored = {
      ...base,
      schema: 1,
      id: "e",
      recordedAt: "2026-01-02T03:04:06.000Z",
    };
    expect(parseEvent(stored, "stored")).toEqual({ ok: true, event: stored });
    expect(rejected({ ...stored, recordedAt: undefined }, "stored").field).toBe(
      "recordedAt",
    );
    expect(rejected({ ...stored, schema: 2 }, "stored").field).toBe("schema");
    expect(rejected({ ...stored, id: undefined }, "stored").field).toBe("id");
  });
});

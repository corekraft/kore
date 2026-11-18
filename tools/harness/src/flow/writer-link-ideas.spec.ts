import { describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { ideaKey, NO_IDEA, writerLinks } from "./writer-link-ideas.js";

vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
}));

const BASE = Date.parse("2026-11-18T10:00:00Z");
const at = (minute: number) => new Date(BASE + minute * 60_000).toISOString();

const event = (
  minute: number,
  kind: Kind,
  fields: Partial<LedgerEvent>,
): LedgerEvent => ({ kind, occurredAt: at(minute), ...fields }) as LedgerEvent;

const link = (minute: number, number: number, agent: string, idea?: string) =>
  event(minute, "pr.linked", {
    source: "herdr",
    number,
    session: agent,
    agent,
    ...(idea === undefined ? {} : { idea }),
  });

const polled = (minute: number, number: number, idea?: string) =>
  event(minute, "pr.opened", {
    source: "github",
    number,
    ...(idea === undefined ? {} : { idea }),
  });

describe("ideaKey: one form for an idea the link and the stamp name differently", () => {
  it("reads a bare issue number as the issue's #n form, which stamps and the poll use", () => {
    expect(ideaKey("1083")).toBe("#1083");
  });

  it("keeps a #n form, a harness idea number with leading zeros and a slug as written", () => {
    expect(ideaKey("#1083")).toBe("#1083");
    expect(ideaKey("0030")).toBe("0030");
    expect(ideaKey("flow-cost")).toBe("flow-cost");
  });
});

describe("writerLinks: the idea each writer session's pull request carries", () => {
  it("gives a link that names an idea that idea", () => {
    const links = writerLinks([link(0, 9, "w1", "0030")]);

    expect(links.get("w1")).toEqual({ number: 9, idea: "0030" });
  });

  it("gives a link that names none no idea, even when the poll set one for the pull request", () => {
    const links = writerLinks([link(0, 9, "w1", NO_IDEA), polled(1, 9, "#7")]);

    expect(links.get("w1")).toEqual({ number: 9, idea: undefined });
  });

  it("falls back to the idea the poll set when the link has none recorded (a link from before the field)", () => {
    const links = writerLinks([link(0, 9, "w1"), polled(1, 9, "#7")]);

    expect(links.get("w1")).toEqual({ number: 9, idea: "#7" });
  });

  it("gives a link with no idea and no poll idea no idea", () => {
    const links = writerLinks([link(0, 9, "w1"), polled(1, 9)]);

    expect(links.get("w1")).toEqual({ number: 9, idea: undefined });
  });

  it("reads the poll idea of the pull request's earliest poll event", () => {
    const links = writerLinks([
      link(0, 9, "w1"),
      polled(5, 9, "#8"),
      polled(1, 9, "#7"),
    ]);

    expect(links.get("w1")).toEqual({ number: 9, idea: "#7" });
  });

  it("charges a session to its earliest link only", () => {
    const links = writerLinks([
      link(5, 10, "w1", "0031"),
      link(0, 9, "w1", "0030"),
    ]);

    expect(links.get("w1")).toEqual({ number: 9, idea: "0030" });
  });

  it("has no entry for a session that opened no linked pull request", () => {
    expect(writerLinks([polled(0, 9, "#7")]).size).toBe(0);
  });

  it("reads a bare issue number on a link in the same form as a stamp", () => {
    expect(writerLinks([link(0, 9, "w1", "1083")]).get("w1")?.idea).toBe(
      "#1083",
    );
  });
});

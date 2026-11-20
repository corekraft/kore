import { describe, expect, it } from "vitest";
import {
  isTicketKey,
  ticketJudgeBrief,
  ticketKey,
  ticketWriterBrief,
} from "./tick-ticket.js";

describe("ticketKey", () => {
  it("names a ticket for its issue", () => {
    expect(ticketKey(1419)).toBe("ticket-1419");
  });

  it("tells a ticket key from an idea number", () => {
    expect(isTicketKey("ticket-1419")).toBe(true);
    expect(isTicketKey("0052")).toBe(false);
  });
});

describe("ticket briefs", () => {
  it("gives the writer the issue number and title, and tells it to read the issue and follow writer.md", () => {
    expect(ticketWriterBrief(1419, "Tick works tickets")).toBe(
      "Work issue #1419: Tick works tickets. Read the issue, follow writer.md, and deliver it as one pull request that says `Refs #1419`. Do not merge.",
    );
  });

  it("gives the judge the pull request, the issue and its title", () => {
    expect(ticketJudgeBrief(7, 1419, "Tick works tickets")).toBe(
      "Judge PR #7 for issue #1419 (Tick works tickets): run the precheck, then approve and merge it, or send it back with the reason.",
    );
  });
});

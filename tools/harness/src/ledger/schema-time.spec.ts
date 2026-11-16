import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const merged = {
  source: "github",
  kind: "pr.merged",
  occurredAt: "2026-01-08T00:00:00Z",
  number: 9,
};

describe("openedAt on a merged pull request (#830)", () => {
  it("accepts the time the pull request opened, for the lead-time fallback", () => {
    const input = { ...merged, openedAt: "2026-01-06T00:00:00Z" };
    expect(parseEvent(input, "input")).toEqual({ ok: true, event: input });
  });

  it("accepts a merged event from before openedAt was recorded, since the field is optional", () => {
    expect(parseEvent(merged, "input")).toEqual({ ok: true, event: merged });
  });

  it.each([
    [{ ...merged, openedAt: "2026-01-06 00:00:00" }, "openedAt"],
    [{ ...merged, openedAt: "2026-02-31T00:00:00Z" }, "openedAt"],
    [{ ...merged, openedAt: 1767657600 }, "openedAt"],
    [
      { ...merged, kind: "pr.opened", openedAt: "2026-01-06T00:00:00Z" },
      "openedAt",
    ],
  ])("rejects %j naming the field %s", (input, field) => {
    const result = parseEvent(input, "input");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ field });
  });
});

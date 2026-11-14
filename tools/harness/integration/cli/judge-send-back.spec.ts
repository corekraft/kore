import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { sendBackBody } from "../../src/judge/index.js";
import { LEDGER, REPO, scenario, type Harness } from "./judge-support.js";

const HEAD = "abc1234def5678abc1234def5678abc1234def56";

const sendBack = (h: Harness, ...extra: string[]) =>
  run(["judge", "send-back", "42", ...extra], h.deps);
const ghCalls = (h: Harness) =>
  h.runner.calls.filter((c) => c.command === "gh").map((c) => c.args.join(" "));
const comments = (h: Harness) =>
  ghCalls(h).filter((c) => c.startsWith("pr comment"));
const events = (h: Harness) =>
  (h.files.get(LEDGER) ?? "")
    .trim()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("judge send-back posts the reason on the queue and the ledger", () => {
  it("comments the reason on the named repository's PR and records it", async () => {
    const h = scenario();
    expect(await sendBack(h, "--reason", "diff touches a chart")).toBe(0);
    expect(comments(h)).toHaveLength(1);
    expect(comments(h)[0]).toContain(`pr comment 42 --repo ${REPO} --body`);
    expect(comments(h)[0]).toContain("diff touches a chart");
    expect(events(h)).toMatchObject([
      {
        kind: "send-back",
        source: "github",
        number: 42,
        label: "diff touches a chart @abc1234",
      },
    ]);
  });

  it("never merges, and only reads the PR to see what it already carries", async () => {
    const h = scenario();
    await sendBack(h, "--reason", "no pattern declared");
    expect(ghCalls(h).map((c) => c.split(" ").slice(0, 2).join(" "))).toEqual([
      "pr view",
      "pr comment",
    ]);
  });

  it("keeps the full reason in the comment and a one-line trimmed one in the ledger", async () => {
    const h = scenario();
    const reason = `${"long reason ".repeat(20)}\nsecond line`;
    await sendBack(h, "--reason", reason);
    expect(comments(h)[0]).toContain("second line");
    const label = String(events(h)[0]?.["label"]);
    expect(label.length).toBeLessThanOrEqual(100);
    expect(label.split("").every((ch) => ch.charCodeAt(0) >= 0x20)).toBe(true);
  });

  it("requires a reason and posts nothing without one", async () => {
    const h = scenario();
    expect(await sendBack(h)).toBe(1);
    expect(await sendBack(h, "--reason", "  ")).toBe(1);
    expect(h.err()).toContain("--reason");
    expect(h.runner.calls).toHaveLength(0);
    expect(h.files.has(LEDGER)).toBe(false);
  });

  it("records nothing when the comment cannot be posted", async () => {
    const h = scenario({
      first: [
        {
          match: (c, a) => c === "gh" && a[1] === "comment",
          result: { code: 1, stderr: "not found" },
        },
      ],
    });
    expect(await sendBack(h, "--reason", "no pattern")).toBe(1);
    expect(h.err()).toContain("not found");
    expect(h.files.has(LEDGER)).toBe(false);
  });
});

describe("judge send-back is safe to rerun", () => {
  const posted = (reason: string, head = HEAD) => ({
    body: sendBackBody(reason, head),
  });

  it("posts nothing twice, and writes the ledger once, when the PR and ledger already carry it", async () => {
    const first = scenario();
    await sendBack(first, "--reason", "no pattern");
    const again = scenario({ comments: [posted("no pattern")] });
    again.files.set(LEDGER, first.files.get(LEDGER) ?? "");
    expect(await sendBack(again, "--reason", "no pattern")).toBe(0);
    expect(comments(again)).toEqual([]);
    expect(events(again)).toHaveLength(1);
  });

  it("finishes the ledger without a second comment after a rejected ledger write", async () => {
    const h = scenario({ comments: [posted("no pattern")] });
    expect(await sendBack(h, "--reason", "no pattern")).toBe(0);
    expect(comments(h)).toEqual([]);
    expect(events(h)).toMatchObject([
      { kind: "send-back", label: "no pattern @abc1234" },
    ]);
  });

  it("posts again for a new head, or a different reason", async () => {
    const newHead = scenario({
      comments: [
        posted("no pattern", "0000000000000000000000000000000000000000"),
      ],
    });
    await sendBack(newHead, "--reason", "no pattern");
    expect(comments(newHead)).toHaveLength(1);
    const other = scenario({ comments: [posted("no pattern")] });
    await sendBack(other, "--reason", "diff mismatch");
    expect(comments(other)).toHaveLength(1);
    expect(events(other)).toMatchObject([{ label: "diff mismatch @abc1234" }]);
  });

  it("writes an event for the same reason on a new head", async () => {
    const first = scenario();
    await sendBack(first, "--reason", "no pattern");
    const next = scenario({
      headSha: "fff1234def5678abc1234def5678abc1234def56",
    });
    next.files.set(LEDGER, first.files.get(LEDGER) ?? "");
    await sendBack(next, "--reason", "no pattern");
    expect(comments(next)).toHaveLength(1);
    expect(events(next).map((e) => e["label"])).toEqual([
      "no pattern @abc1234",
      "no pattern @fff1234",
    ]);
  });

  it("records a repeat reason after a different one", async () => {
    const h = scenario();
    h.files.set(
      LEDGER,
      `${JSON.stringify({ id: "x", schema: 1, recordedAt: "2026-01-01T00:00:00.000Z", source: "github", kind: "send-back", occurredAt: "2026-01-01T00:00:00.000Z", number: 42, label: "other" })}\n`,
    );
    await sendBack(h, "--reason", "no pattern");
    expect(events(h).map((e) => e["label"])).toEqual([
      "other",
      "no pattern @abc1234",
    ]);
  });
});

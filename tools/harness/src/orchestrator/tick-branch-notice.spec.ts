import { describe, expect, it, vi } from "vitest";
import { HarnessCliError } from "./harness-cli.js";
import {
  BranchNotice,
  branchNoticeBody,
  branchNoticeKey,
  type BranchPorts,
} from "./tick-branch-notice.js";

const IDEA = "0034";
const WRITER = "idea-0034-writer-abc1234";
const PR = 1234;
const HEAD = "abc1234def5678";
const MAIN = "9988776655aabb";
/** The dedupe key for the default heads: the PR head and main head, each seven characters. */
const KEY = "branch-notice:1234:abc1234:9988776";

function ports(over: Partial<BranchPorts> = {}): BranchPorts {
  return {
    delivery: vi.fn().mockResolvedValue({ pr: PR, merged: false }),
    panes: vi.fn().mockResolvedValue([{ name: WRITER, state: "running" }]),
    mergeState: vi.fn().mockResolvedValue("DIRTY"),
    ciGreen: vi.fn().mockResolvedValue(true),
    precheckFailing: vi.fn().mockResolvedValue(false),
    head: vi.fn().mockResolvedValue(HEAD),
    mainHead: vi.fn().mockResolvedValue(MAIN),
    sent: vi.fn().mockResolvedValue(false),
    send: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
    backend: "herdr",
    ...over,
  };
}

describe("BranchNotice.check: the notice follows the backend its writer runs on", () => {
  it("sends an hc writer the report form of the pinned reply, never the RESULT line", async () => {
    const p = ports({ backend: "hc" });

    await new BranchNotice(p).check(IDEA, 34);

    expect(p.send).toHaveBeenCalledWith(
      WRITER,
      branchNoticeBody("conflict", PR, "hc"),
    );
  });
});

describe("BranchNotice.check: which PRs get a notice", () => {
  it("sends one follow-up to the live writer of a PR that conflicts with main, and records it", async () => {
    const p = ports();

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.send).toHaveBeenCalledWith(
      WRITER,
      branchNoticeBody("conflict", PR),
    );
    expect(p.record).toHaveBeenCalledWith({
      idea: IDEA,
      key: KEY,
      writer: WRITER,
    });
    expect(report).toContain(`PR #${PR}`);
  });

  it("sends one follow-up to a PR that is ready to merge but behind main, once CI is green and the precheck has no failure", async () => {
    const p = ports({ mergeState: vi.fn().mockResolvedValue("BEHIND") });

    await new BranchNotice(p).check(IDEA, 34);

    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.send).toHaveBeenCalledWith(
      WRITER,
      branchNoticeBody("behind-and-ready", PR),
    );
  });

  it("sends nothing to a PR that is behind main with checks pending or red", async () => {
    const p = ports({
      mergeState: vi.fn().mockResolvedValue("BEHIND"),
      ciGreen: vi.fn().mockResolvedValue(false),
    });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
    expect(report).toBeUndefined();
  });

  it("sends nothing to a PR that is behind main while the judge precheck reports a failure", async () => {
    const p = ports({
      mergeState: vi.fn().mockResolvedValue("BEHIND"),
      precheckFailing: vi.fn().mockResolvedValue(true),
    });

    await new BranchNotice(p).check(IDEA, 34);

    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("sends nothing to a PR whose merge state is neither conflicting nor behind, and reads no CI or precheck state for it", async () => {
    const p = ports({ mergeState: vi.fn().mockResolvedValue("CLEAN") });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(p.ciGreen).not.toHaveBeenCalled();
    expect(p.precheckFailing).not.toHaveBeenCalled();
    expect(p.send).not.toHaveBeenCalled();
    expect(report).toBeUndefined();
  });

  it("sends nothing for a merged PR, or for an idea with no pull request", async () => {
    const merged = ports({
      delivery: vi.fn().mockResolvedValue({ pr: PR, merged: true }),
    });
    const none = ports({
      delivery: vi.fn().mockResolvedValue({ merged: false }),
    });

    await new BranchNotice(merged).check(IDEA, 34);
    await new BranchNotice(none).check(IDEA, 34);

    expect(merged.mergeState).not.toHaveBeenCalled();
    expect(none.mergeState).not.toHaveBeenCalled();
    expect(merged.send).not.toHaveBeenCalled();
    expect(none.send).not.toHaveBeenCalled();
  });
});

describe("BranchNotice.check: never twice for the same heads", () => {
  it("sends nothing on a second pass when the PR head and main head were already noticed", async () => {
    const p = ports({ sent: vi.fn().mockResolvedValue(true) });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(p.sent).toHaveBeenCalledWith(IDEA, KEY);
    expect(p.send).not.toHaveBeenCalled();
    expect(report).toBeUndefined();
  });

  it("sends again when main's head has changed since the last notice", async () => {
    const newMain = "1111111aaaaaaa";
    const p = ports({
      mainHead: vi.fn().mockResolvedValue(newMain),
      sent: vi.fn(async (_idea: string, key: string) => key === KEY),
    });

    await new BranchNotice(p).check(IDEA, 34);

    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.record).toHaveBeenCalledWith({
      idea: IDEA,
      key: "branch-notice:1234:abc1234:1111111",
      writer: WRITER,
    });
  });
});

describe("BranchNotice.check: what it reports and does not send", () => {
  it("reports an unreadable merge state by PR, and sends nothing", async () => {
    const p = ports({
      mergeState: vi
        .fn()
        .mockRejectedValue(new HarnessCliError("gh pr view failed")),
    });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(report).toContain(`PR #${PR}`);
    expect(report).toContain("merge state is unreadable");
    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("reports unreadable CI for a PR behind main, and sends nothing", async () => {
    const p = ports({
      mergeState: vi.fn().mockResolvedValue("BEHIND"),
      ciGreen: vi
        .fn()
        .mockRejectedValue(new HarnessCliError("gh pr view failed")),
    });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(report).toContain("CI is unreadable");
    expect(p.send).not.toHaveBeenCalled();
  });

  it("reports that no writer pane is live, and sends nothing, when the writer has already finished and closed", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([{ name: WRITER, state: "closed" }]),
    });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(report).toContain("no writer pane is live");
    expect(report).toContain(`PR #${PR}`);
    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("reports a failed delivery and records nothing, so the next pass tries again", async () => {
    const p = ports({
      send: vi
        .fn()
        .mockResolvedValue("Delivery not confirmed: no new line showed"),
    });

    const report = await new BranchNotice(p).check(IDEA, 34);

    expect(report).toContain("Delivery not confirmed");
    expect(p.record).not.toHaveBeenCalled();
  });
});

describe("branchNoticeBody", () => {
  it("names the trigger, repeats the writer's rule, and asks for the pinned reply as the RESULT line", () => {
    const body = branchNoticeBody("conflict", PR);

    expect(body).toContain("PR #1234 conflicts with main");
    expect(body).toContain("Merge origin/main into your branch");
    expect(body).toContain("never rebase or force-push");
    expect(body).toContain(
      "reply with exactly `pinned: no change` as your RESULT line and stop",
    );
  });

  it("asks an hc writer to report its pinned reply, one line, and names no RESULT line", () => {
    const body = branchNoticeBody("conflict", PR, "hc");

    expect(body).toBe(
      'Branch update notice: PR #1234 conflicts with main. Merge origin/main into your branch and push it; never rebase or force-push. If your brief pins a live proof to your head, run `harness session report --outcome done --summary "pinned: no change"` and stop.',
    );
    expect(body).not.toMatch(/RESULT|\n/);
  });

  it("keeps the herdr notice unchanged when no backend is given", () => {
    expect(branchNoticeBody("conflict", PR)).toBe(
      branchNoticeBody("conflict", PR, "herdr"),
    );
  });

  it("says a PR ready but behind is behind main, for the behind-and-ready trigger", () => {
    expect(branchNoticeBody("behind-and-ready", PR)).toContain(
      "PR #1234 is ready to merge but is behind main",
    );
  });

  it("is one line, since session send refuses a message that spans lines", () => {
    expect(branchNoticeBody("conflict", PR)).not.toMatch(/[\r\n]/);
  });
});

describe("branchNoticeKey", () => {
  it("names the PR, its head and main's head, each head to seven characters", () => {
    expect(branchNoticeKey(PR, HEAD, MAIN)).toBe(KEY);
  });
});

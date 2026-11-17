import { describe, expect, it } from "vitest";
import { judgmentBrief, readerBrief } from "./judgment-briefs.js";

/** Lines a brief would print as a marker on a line of their own, which a pane echo could read as its plan or result. */
const bareLines = (brief: string) =>
  brief.split("\n").filter((line) => /^\s*(?:[●⏺]\s+)?[A-Z-]+\s*$/.test(line));

describe("judgmentBrief", () => {
  it("names the idea, its issue, its pull request and the send-backs that started the decision", () => {
    const brief = judgmentBrief("0007", 873, 12, {
      kind: "start",
      sendBacks: 3,
    });

    expect(brief).toContain("idea 0007");
    expect(brief).toContain("issue #873");
    expect(brief).toContain("pull request #12");
    expect(brief).toContain("sent back 3 times");
  });

  it("says the tick does not know the pull request when none is open", () => {
    const brief = judgmentBrief("0007", 873, undefined, {
      kind: "start",
      sendBacks: 3,
    });

    expect(brief).toContain("no pull request is known");
  });

  it("carries the refusal verbatim on a retry, and says it is the retry", () => {
    const reason =
      "Plan work item 2 has field name: the name a is already used by item 1. The whole plan is refused and nothing was started; fix the judgment pane's plan and rerun.";
    const brief = judgmentBrief("0007", 873, 12, { kind: "retry", reason });

    expect(brief).toContain("retry");
    expect(brief).toContain(reason);
  });

  it("lists each reader summary under its pane name, in order, after the reads", () => {
    const brief = judgmentBrief("0007", 873, 12, {
      kind: "after-reads",
      summaries: [
        { name: "idea-0007-read-r1-q1", text: "Question: a\n- one" },
        { name: "idea-0007-read-r1-q2", text: "Question: b\n- two" },
      ],
    });

    const first = brief.indexOf("idea-0007-read-r1-q1");
    const second = brief.indexOf("idea-0007-read-r1-q2");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(brief).toContain("- two");
  });

  it("tells the pane it starts no pane and changes no file", () => {
    const brief = judgmentBrief("0007", 873, 12, {
      kind: "start",
      sendBacks: 3,
    });

    expect(brief).toContain("start no pane");
    expect(brief).toContain("change no file");
  });

  it("never writes a plan, summary or result marker alone on a line, so an echo of the brief cannot be read as the pane's own output", () => {
    const brief = judgmentBrief("0007", 873, 12, {
      kind: "after-reads",
      summaries: [{ name: "idea-0007-read-r1-q1", text: "- one" }],
    });

    expect(bareLines(brief)).toEqual([]);
    expect(brief.split("\n").some((line) => /^\s*RESULT\s*:/.test(line))).toBe(
      false,
    );
  });
});

describe("readerBrief", () => {
  it("asks one question of the given paths only, and says the answer starts with the question", () => {
    const brief = readerBrief("0007", 873, {
      question: "Where is the retry counted?",
      paths: ["tools/harness/src/orchestrator/judgment-flow.ts"],
    });

    expect(brief).toContain("Where is the retry counted?");
    expect(brief).toContain("tools/harness/src/orchestrator/judgment-flow.ts");
    expect(brief).toContain("read only these paths");
    expect(brief).toContain("Question:");
  });

  it("changes no file and writes no marker on a line of its own", () => {
    const brief = readerBrief("0007", 873, {
      question: "q",
      paths: ["docs/index.md"],
    });

    expect(brief).toContain("change no file");
    expect(bareLines(brief)).toEqual([]);
  });
});

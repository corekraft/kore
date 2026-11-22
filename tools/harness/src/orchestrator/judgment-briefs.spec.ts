import { describe, expect, it } from "vitest";
import {
  judgmentBrief,
  pieceBrief,
  readerBrief,
  rebriefBrief,
} from "./judgment-briefs.js";

/** Lines a brief would print as a marker on a line of their own, which a pane echo could read as its plan or result. */
const bareLines = (brief: string) =>
  brief.split("\n").filter((line) => /^\s*(?:[●⏺]\s+)?[A-Z-]+\s*$/.test(line));

const HC_PLAN = `End with one JSON object that is your plan, with exactly one of reads, work or stop. Reads is a list of objects with question and paths; work is a list of objects with role (writer or reader), name, brief, files and after; stop is an object with reason. Then, as your last action, run \`node skills/bin/harness.mjs session report --outcome done --summary "plan written" --plan - <<'EOF'\`, with that object on the lines after it, then a line that reads EOF.`;
const HC_ANSWER = `Then, as your last action, run \`node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'\`, with your answer on the lines after it, then a line that reads EOF. Use --outcome blocked only when you cannot answer.`;

describe("judgmentBrief on hc", () => {
  it("ends with a plan file that session report carries, never a PLAN-JSON marker or RESULT line", () => {
    const brief = judgmentBrief(
      "0007",
      873,
      12,
      { kind: "start", sendBacks: 3 },
      "hc",
    );

    expect(brief).toContain(HC_PLAN);
    expect(brief).not.toMatch(/PLAN-JSON|RESULT/);
  });

  it("keeps the herdr brief unchanged when no backend is given", () => {
    const decision = { kind: "start", sendBacks: 3 } as const;

    expect(judgmentBrief("0007", 873, 12, decision)).toBe(
      judgmentBrief("0007", 873, 12, decision, "herdr"),
    );
    expect(judgmentBrief("0007", 873, 12, decision)).toContain("PLAN-JSON");
  });
});

describe("readerBrief on hc", () => {
  it("answers through its report's summary, given on stdin, never the SUMMARY markers or a RESULT line", () => {
    const brief = readerBrief(
      "0007",
      873,
      { question: "Which tests?", paths: ["tools/x.ts"] },
      "hc",
    );

    expect(brief).toContain(HC_ANSWER);
    expect(brief).not.toMatch(/SUMMARY-BEGIN|SUMMARY-END|RESULT/);
  });
});

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

describe("rebriefBrief", () => {
  it("keeps the writer's invariants: the idea's issue in a Refs line, and no merge", () => {
    const brief = rebriefBrief("0007", 873, {
      brief: "Split the retry logic out first.",
      files: [],
    });

    expect(brief).toContain("idea 0007");
    expect(brief).toContain("`Refs #873`");
    expect(brief).toContain("Do not merge");
  });

  it("carries the judgment's brief as the work to do now", () => {
    const brief = rebriefBrief("0007", 873, {
      brief: "Split the retry logic out first.",
      files: [],
    });

    expect(brief).toContain("Split the retry logic out first.");
    expect(brief).toContain("re-briefed");
  });

  it("names the only paths the writer may change when the piece lists files, and names none when it lists none", () => {
    const scoped = rebriefBrief("0007", 873, {
      brief: "b",
      files: ["tools/harness/src/orchestrator/tick-judgment.ts"],
    });
    const open = rebriefBrief("0007", 873, { brief: "b", files: [] });

    expect(scoped).toContain(
      "Change only these paths: tools/harness/src/orchestrator/tick-judgment.ts.",
    );
    expect(open).not.toContain("Change only these paths");
  });

  it("never writes a plan or result marker alone on a line, so the writer's output cannot be read as a judgment plan", () => {
    const brief = rebriefBrief("0007", 873, {
      brief: "PLAN-JSON\nRESULT: done",
      files: [],
    });

    expect(bareLines(brief)).toEqual([]);
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

describe("pieceBrief", () => {
  it("briefs a writer piece exactly as a re-brief of the idea's pull request", () => {
    expect(
      pieceBrief("0007", 873, {
        role: "writer",
        name: "docs",
        brief: "Document the piece.",
        files: ["docs/a.md"],
        after: [],
      }),
    ).toBe(
      rebriefBrief("0007", 873, {
        brief: "Document the piece.",
        files: ["docs/a.md"],
      }),
    );
  });

  it("briefs a reader piece exactly as a reader of its files, asking its brief as the question", () => {
    expect(
      pieceBrief("0007", 873, {
        role: "reader",
        name: "tests",
        brief: "Which tests cover it?",
        files: ["tools/x.ts"],
        after: [],
      }),
    ).toBe(
      readerBrief("0007", 873, {
        question: "Which tests cover it?",
        paths: ["tools/x.ts"],
      }),
    );
  });
});

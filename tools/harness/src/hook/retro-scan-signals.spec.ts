// What the retro scan counts as a failure or a correction, on synthetic transcripts.

import { describe, expect, it } from "vitest";
import { scan } from "./retro-scan.js";
import {
  failure,
  human,
  options,
  toolTurn,
  twoSessions,
} from "./retro-scan-support.js";

describe("retro scan failure grouping", () => {
  it("groups a command failure by the first error-looking line after its exit code, else by the exit code alone", () => {
    const text = [
      ...failure(
        "x1",
        "Exit code 1\ntotal 8\n# Kore\nnpm error missing script: build",
      ),
      ...failure("x2", "Exit code 1\nfatal: not a git repository"),
      ...failure("x3", "Exit code 2\nM .claude/evals/eval.mjs\n──────"),
      ...failure("x4", "Exit code 1\nzsh: command not found: foo"),
    ].join("\n");
    const { failures } = scan([{ id: "s", text }], options);
    expect(failures.map((item) => item.error).sort()).toEqual([
      "Exit code 1: fatal: not a git repository",
      "Exit code 1: npm error missing script: build",
      "Exit code 1: zsh: command not found: foo",
      "Exit code 2",
    ]);
  });

  it("does not take stdout that only resembles an error as the failure summary", () => {
    const text = [
      ...failure("y1", "Exit code 1\nname: add-command"),
      ...failure(
        "y2",
        "Exit code 1\nimport { doctor, doctorFailed } from './x';",
      ),
      ...failure(
        "y3",
        "Exit code 1\n- [x] A large lint or type-error output is bounded",
      ),
      ...failure("y4", "Exit code 1\n# Notes on error handling"),
      ...failure("y5", "Exit code 1\nexport const failure = 1;"),
      ...failure("y6", "Exit code 1\n| error | count |"),
    ].join("\n");
    expect(scan([{ id: "s", text }], options).failures).toEqual([
      { tool: "Bash", error: "Exit code 1", count: 6 },
    ]);
  });
});

describe("retro scan corrections", () => {
  it("merges several repeated phrases from the same messages into one correction", () => {
    const text = JSON.stringify({
      type: "user",
      timestamp: "2026-11-03T00:00:00.000Z",
      message: {
        role: "user",
        content: "Never touch the shared stash. Always ask before you push.",
      },
    });
    const { corrections } = scan(
      [
        { id: "p", text },
        { id: "q", text },
      ],
      options,
    );
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.sessions).toBe(2);
    expect(corrections[0]?.evidence).toHaveLength(2);
  });

  it("does not call a repeated neutral prompt a correction", () => {
    const sessions = twoSessions(() =>
      human("01", "Quote verbatim any session start hook additional context"),
    );
    expect(scan(sessions, options).corrections).toEqual([]);
  });

  it("calls a repeated phrase a correction when it has a correction word, matched as a whole word", () => {
    const corrections = (text: string) =>
      scan(
        twoSessions(() => human("01", text)),
        options,
      ).corrections;
    expect(
      corrections("Stop editing the widget manifests directly"),
    ).toHaveLength(1);
    expect(
      corrections("Please don't edit the widget manifests directly"),
    ).toHaveLength(1);
    expect(
      corrections("Another nobody knows nothing about widget manifests today"),
    ).toEqual([]);
  });
});

describe("retro scan orchestrator briefs", () => {
  const brief = "Never touch the shared stash. Always ask before you push.";
  it.each([
    ["(orchestrator) header", `(orchestrator) ${brief}`],
    ["Orchestrator: header", `Orchestrator: ${brief}`],
    ["[herdr:…] header", `[herdr:retro-writer] ${brief}`],
    ["indented, any case", `  \n ORCHESTRATOR: ${brief}`],
  ])("does not count a message with a %s as a correction", (_name, text) => {
    const sessions = twoSessions(() => human("01", text));
    expect(scan(sessions, options).corrections).toEqual([]);
  });

  it("still counts a person's correction that only mentions the orchestrator", () => {
    const sessions = twoSessions(() =>
      human("01", `Stop letting the orchestrator ${brief}`),
    );
    expect(scan(sessions, options).corrections).not.toEqual([]);
  });
});

describe("retro scan corrections after failures", () => {
  it("ignores a correction word inside pasted content", () => {
    const sessions = twoSessions(() =>
      human(
        "01",
        '<pasted_content id="z">Never do that.</pasted_content> summarize widget manifests for review',
      ),
    );
    expect(scan(sessions, options).corrections).toEqual([]);
  });

  it("calls a repeated neutral phrase right after a failed tool call a correction", () => {
    const sessions = twoSessions((id) =>
      [
        toolTurn("01", `${id}1`, true),
        human("02", "Summarize the widget manifests for review"),
      ].join("\n"),
    );
    expect(scan(sessions, options).corrections).toHaveLength(1);
  });

  it("does not let a failure before an earlier human message taint a later neutral message", () => {
    const sessions = twoSessions((id) =>
      [
        toolTurn("01", `${id}1`, true),
        human("02", `Carry on with step number ${id} please`),
        toolTurn("03", `${id}2`, false),
        human("04", "Summarize the widget manifests for review"),
      ].join("\n"),
    );
    expect(scan(sessions, options).corrections).toEqual([]);
  });
});

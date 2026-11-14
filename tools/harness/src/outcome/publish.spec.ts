import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaError } from "../idea/index.js";
import { labelFor } from "./model.js";
import { fakeRunner } from "./outcome-support.js";
import { publishOutcome } from "./publish.js";

vi.mock("./model.js");

const ROOT = "/repo";
const TARGET = { number: "300", repo: "corekraft/kore" };
const MARKER = "<!-- harness outcome idea 0001 -->";
const COMMENT = `${MARKER}\n\nUp time fell from 41s to 29s.\n`;
const OUTCOME: Parameters<typeof publishOutcome>[3] = {
  idea: "0001",
  result: "confirmed",
  marker: MARKER,
  comment: COMMENT,
};
const AT = ["--repo", "corekraft/kore"];
const FIX = "Check `gh auth status`, then rerun `harness outcome close`.";
const VIEW = [
  "gh",
  ["issue", "view", "300", ...AT, "--json", "state,labels,comments"],
  { cwd: ROOT },
];

/** The issue as `gh issue view --json state,labels,comments` prints it. */
function view(
  state: string,
  labels: unknown[] = [],
  comments: unknown[] = [],
): string {
  return JSON.stringify({ state, labels, comments });
}

/**
 * A runner whose `gh issue view` prints `viewed`. Any other call succeeds,
 * unless `fail` names its subcommand, which then exits 1 with `stderr`.
 */
function ghRunner(viewed: string, fail?: { step: string; stderr: string }) {
  return fakeRunner((_command, args) => {
    if (args[1] === "view") {
      return { stdout: viewed };
    }
    if (fail !== undefined && args[1] === fail.step) {
      return { stderr: fail.stderr, code: 1 };
    }
    return {};
  });
}

beforeEach(() => {
  vi.mocked(labelFor).mockImplementation((result) => `outcome:${result}`);
});

describe("publishOutcome on an open issue with nothing published yet", () => {
  it("views the issue once, then labels, comments and closes it, in that order", async () => {
    const runner = ghRunner(view("OPEN", [{ name: "ready-for-agent" }]));
    expect(await publishOutcome(runner, ROOT, TARGET, OUTCOME)).toEqual({
      commented: true,
      labelled: true,
      closed: true,
    });
    expect(runner.run.mock.calls).toEqual([
      VIEW,
      [
        "gh",
        ["issue", "edit", "300", ...AT, "--add-label", "outcome:confirmed"],
        { cwd: ROOT },
      ],
      [
        "gh",
        ["issue", "comment", "300", ...AT, "--body-file", "-"],
        { cwd: ROOT, input: COMMENT },
      ],
      ["gh", ["issue", "close", "300", ...AT], { cwd: ROOT }],
    ]);
  });
});

describe("publishOutcome when the issue is already done", () => {
  it("makes no gh write when the label, the comment and the closed state are all present", async () => {
    const runner = ghRunner(
      view(
        "CLOSED",
        [{ name: "outcome:confirmed" }],
        [{ body: `${MARKER}\n\nold` }],
      ),
    );
    expect(await publishOutcome(runner, ROOT, TARGET, OUTCOME)).toEqual({
      commented: false,
      labelled: false,
      closed: false,
    });
    expect(runner.run.mock.calls).toEqual([VIEW]);
  });

  it("finishes only the close when the label and the comment are already on an open issue", async () => {
    const runner = ghRunner(
      view("OPEN", [{ name: "outcome:confirmed" }], [{ body: MARKER }]),
    );
    expect(await publishOutcome(runner, ROOT, TARGET, OUTCOME)).toEqual({
      commented: false,
      labelled: false,
      closed: true,
    });
    expect(runner.run.mock.calls).toEqual([
      VIEW,
      ["gh", ["issue", "close", "300", ...AT], { cwd: ROOT }],
    ]);
  });
});

describe("publishOutcome label and comment rules", () => {
  it("adds the wanted label and removes every stale outcome label, leaving exactly one", async () => {
    const runner = ghRunner(
      view("OPEN", [
        { name: "outcome:refuted" },
        { name: "outcome:inconclusive" },
        { name: "ready-for-agent" },
      ]),
    );
    await publishOutcome(runner, ROOT, TARGET, OUTCOME);
    expect(runner.run.mock.calls[1]).toEqual([
      "gh",
      [
        "issue",
        "edit",
        "300",
        ...AT,
        "--add-label",
        "outcome:confirmed",
        "--remove-label",
        "outcome:refuted",
        "--remove-label",
        "outcome:inconclusive",
      ],
      { cwd: ROOT },
    ]);
  });

  it("removes a stale label without adding the wanted one again", async () => {
    const runner = ghRunner(
      view("OPEN", [
        { name: "outcome:confirmed" },
        { name: "outcome:refuted" },
      ]),
    );
    expect(await publishOutcome(runner, ROOT, TARGET, OUTCOME)).toMatchObject({
      labelled: true,
    });
    expect(runner.run.mock.calls[1]).toEqual([
      "gh",
      ["issue", "edit", "300", ...AT, "--remove-label", "outcome:refuted"],
      { cwd: ROOT },
    ]);
  });
});

describe("publishOutcome comment rules", () => {
  it("posts the comment when no existing comment carries the marker", async () => {
    const runner = ghRunner(
      view("OPEN", [{ name: "outcome:confirmed" }], [{ body: "unrelated" }]),
    );
    expect(await publishOutcome(runner, ROOT, TARGET, OUTCOME)).toMatchObject({
      commented: true,
      labelled: false,
    });
    expect(runner.run.mock.calls[1]).toEqual([
      "gh",
      ["issue", "comment", "300", ...AT, "--body-file", "-"],
      { cwd: ROOT, input: COMMENT },
    ]);
  });

  it("ignores labels and comments that are not objects with a string name or body", async () => {
    const runner = ghRunner(
      view(
        "OPEN",
        [{ name: "outcome:confirmed" }, {}, "outcome:refuted", null],
        [{ body: 5 }, null, { body: MARKER }],
      ),
    );
    expect(await publishOutcome(runner, ROOT, TARGET, OUTCOME)).toEqual({
      commented: false,
      labelled: false,
      closed: true,
    });
    expect(runner.run.mock.calls).toEqual([
      VIEW,
      ["gh", ["issue", "close", "300", ...AT], { cwd: ROOT }],
    ]);
  });
});

describe("publishOutcome failures name the step and how to resume", () => {
  it("reports unreadable gh output instead of guessing the issue state, and writes nothing", async () => {
    const runner = fakeRunner(() => ({ stdout: "not json" }));
    const failure = publishOutcome(runner, ROOT, TARGET, OUTCOME);
    await expect(failure).rejects.toBeInstanceOf(IdeaError);
    await expect(failure).rejects.toThrow(
      new IdeaError(`gh returned unreadable output for issue 300; ${FIX}`),
    );
    expect(runner.run.mock.calls).toEqual([VIEW]);
  });

  it("names the view step, its stderr and the fix when gh cannot view the issue", async () => {
    const runner = fakeRunner(() => ({ stderr: "HTTP 502\n", code: 1 }));
    await expect(publishOutcome(runner, ROOT, TARGET, OUTCOME)).rejects.toThrow(
      new IdeaError(`gh issue view failed for issue 300: HTTP 502. ${FIX}`),
    );
    expect(runner.run.mock.calls).toEqual([VIEW]);
  });

  it("names the close step when closing fails, after the label and comment are written", async () => {
    const runner = ghRunner(view("OPEN"), {
      step: "close",
      stderr: "HTTP 502",
    });
    await expect(publishOutcome(runner, ROOT, TARGET, OUTCOME)).rejects.toThrow(
      new IdeaError(`gh issue close failed for issue 300: HTTP 502. ${FIX}`),
    );
    expect(runner.run.mock.calls.map(([, args]) => args[1])).toEqual([
      "view",
      "edit",
      "comment",
      "close",
    ]);
  });

  it("names the label and the command that creates it when the repository lacks it", async () => {
    const runner = ghRunner(view("OPEN"), {
      step: "edit",
      stderr: "failed to update: 'outcome:confirmed' not found",
    });
    await expect(publishOutcome(runner, ROOT, TARGET, OUTCOME)).rejects.toThrow(
      new IdeaError(
        'The label "outcome:confirmed" does not exist on corekraft/kore; create it with `gh label create outcome:confirmed --repo corekraft/kore`, then rerun `harness outcome close --idea 0001`.',
      ),
    );
    expect(runner.run.mock.calls.map(([, args]) => args[1])).toEqual([
      "view",
      "edit",
    ]);
  });

  it("keeps the generic failure for a not-found error about another label", async () => {
    const runner = ghRunner(view("OPEN"), {
      step: "edit",
      stderr: "failed to update: 'outcome:refuted' not found",
    });
    await expect(publishOutcome(runner, ROOT, TARGET, OUTCOME)).rejects.toThrow(
      new IdeaError(
        `gh issue edit failed for issue 300: failed to update: 'outcome:refuted' not found. ${FIX}`,
      ),
    );
  });
});

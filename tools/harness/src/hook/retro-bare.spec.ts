// Which segments of one Bash command post to GitHub or type into a pane without
// the harness. A pure function over the command text; nothing is mocked.

import { describe, expect, it } from "vitest";
import { BareTally, bareSends } from "./retro-bare.js";

describe("bare send classifier", () => {
  it("counts a bare gh issue or pr comment as a gh send", () => {
    expect(bareSends('gh issue comment 836 --body "done"')).toEqual(["gh"]);
    expect(bareSends("gh pr comment 903 --body-file /tmp/x.md")).toEqual([
      "gh",
    ]);
  });

  it("does not count the harness command that posts on an agent's behalf", () => {
    expect(
      bareSends("node skills/bin/harness.mjs pr open --title x --body y"),
    ).toEqual([]);
    expect(
      bareSends(
        "node skills/bin/harness.mjs session notify w3:p1 --outcome done",
      ),
    ).toEqual([]);
  });

  it("counts a comment API write, and not a read of comments", () => {
    expect(bareSends("gh api repos/o/r/issues/1/comments")).toEqual([]);
    expect(
      bareSends("gh api repos/o/r/issues/1/comments -f body=hello"),
    ).toEqual(["gh"]);
    expect(
      bareSends("gh api -X POST repos/o/r/issues/1/comments -f body=hello"),
    ).toEqual(["gh"]);
    expect(
      bareSends("gh api --method PATCH repos/o/r/issues/comments/9 -f body=x"),
    ).toEqual(["gh"]);
    expect(bareSends("gh api repos/o/r/issues/comments/9 -X GET")).toEqual([]);
  });

  it("counts a graphql addComment mutation as a comment API write", () => {
    expect(
      bareSends(
        'gh api graphql -f query=\'mutation { addComment(input: {subjectId: "x", body: "y"}) { clientMutationId } }\'',
      ),
    ).toEqual(["gh"]);
  });

  it("reads each segment of a chained command on its own", () => {
    expect(bareSends("cd repo && gh pr comment 3 --body y")).toEqual(["gh"]);
    expect(
      bareSends(
        "gh pr view 3 && herdr pane send-text w1:p1 hi; gh issue comment 4",
      ),
    ).toEqual(["herdr", "gh"]);
  });

  it("skips leading environment assignments before the command", () => {
    expect(bareSends("GH_TOKEN=abc gh issue comment 1 --body x")).toEqual([
      "gh",
    ]);
  });

  it("counts herdr pane send-text and send-keys, and not reads or closes", () => {
    expect(bareSends("herdr pane send-text w2:p1 'hello'")).toEqual(["herdr"]);
    expect(bareSends("herdr pane send-keys w2:p1 Enter")).toEqual(["herdr"]);
    expect(bareSends("herdr pane read w2:p1")).toEqual([]);
    expect(bareSends("herdr pane close w2:p1")).toEqual([]);
    expect(bareSends("herdr agent list")).toEqual([]);
  });

  it("does not count a command name that only appears inside another command's text", () => {
    expect(bareSends('echo "gh issue comment 1 would post"')).toEqual([]);
    expect(bareSends("grep -r 'herdr pane send-text' docs")).toEqual([]);
    expect(bareSends("git log --oneline -3")).toEqual([]);
  });
});

describe("bare tally", () => {
  it("counts per role session and rolls up per role, using the role each session name was launched as", () => {
    const tally = new BareTally({ w1: "writer", f1: "fixer", w2: "writer" });
    tally.add("a", { sessionName: "w1", bare: { gh: 2, herdr: 0 } });
    tally.add("b", { sessionName: "f1", bare: { gh: 0, herdr: 1 } });
    tally.add("c", { sessionName: "x9", bare: { gh: 1, herdr: 0 } });
    tally.add("e", { sessionName: "w2", bare: { gh: 0, herdr: 0 } });
    expect(tally.report()).toEqual({
      perSession: {
        a: { role: "writer", gh: 2, herdr: 0 },
        b: { role: "fixer", gh: 0, herdr: 1 },
        c: { role: "unknown", gh: 1, herdr: 0 },
      },
      perRole: {
        fixer: { sessions: 1, gh: 0, herdr: 1 },
        unknown: { sessions: 1, gh: 1, herdr: 0 },
        writer: { sessions: 1, gh: 2, herdr: 0 },
      },
    });
  });

  it("leaves out the main session, whose commands name no spawn brief", () => {
    const tally = new BareTally({ w1: "writer" });
    tally.add("main", { sessionName: undefined, bare: { gh: 4, herdr: 3 } });
    expect(tally.report()).toEqual({ perSession: {}, perRole: {} });
  });

  it("lists sessions and roles by name, whatever order they were added in", () => {
    const tally = new BareTally({ w1: "writer", f1: "fixer" });
    tally.add("z", { sessionName: "w1", bare: { gh: 1, herdr: 0 } });
    tally.add("m", { sessionName: "f1", bare: { gh: 1, herdr: 0 } });
    tally.add("a", { sessionName: "w1", bare: { gh: 1, herdr: 0 } });
    const report = tally.report();
    expect(Object.keys(report.perSession)).toEqual(["a", "m", "z"]);
    expect(Object.keys(report.perRole)).toEqual(["fixer", "writer"]);
  });
});

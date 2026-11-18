import { describe, expect, it } from "vitest";
import { fakeRunner, type FakeRunner } from "./deps-support.js";
import { issueLabels } from "./spawn-labels.js";

const ROOT = "/main";

function answer(runner: FakeRunner, code: number, stdout: string) {
  runner.run.mockResolvedValueOnce({ code, stdout, stderr: "" });
}

describe("issueLabels reads the label names an idea's issue carries", () => {
  it("asks gh for the issue's labels, through the runner, in the main checkout, without the # of the idea", async () => {
    const runner = fakeRunner();
    answer(runner, 0, '{"labels":[]}');

    await issueLabels(runner, ROOT, "#1004");

    expect(runner.run).toHaveBeenCalledExactlyOnceWith(
      "gh",
      ["issue", "view", "1004", "--json", "labels"],
      { cwd: ROOT },
    );
  });

  it("returns each label's name, in the order gh lists them", async () => {
    const runner = fakeRunner();
    answer(
      runner,
      0,
      '{"labels":[{"name":"ready-for-agent"},{"name":"tooling"}]}',
    );

    await expect(issueLabels(runner, ROOT, "#1004")).resolves.toEqual([
      "ready-for-agent",
      "tooling",
    ]);
  });

  it("returns only label names, never the title or body text the same reply carries", async () => {
    const runner = fakeRunner();
    answer(
      runner,
      0,
      '{"title":"secret title","body":"secret body","labels":[{"name":"bug","color":"ff0000"}]}',
    );

    const names = await issueLabels(runner, ROOT, "#1004");

    expect(names).toEqual(["bug"]);
    expect(JSON.stringify(names)).not.toContain("secret");
  });

  it("returns no names for an issue with no labels, which is a lookup that worked", async () => {
    const runner = fakeRunner();
    answer(runner, 0, '{"labels":[]}');

    await expect(issueLabels(runner, ROOT, "#1004")).resolves.toEqual([]);
  });

  it("returns undefined when gh exits non-zero, so the caller records nothing", async () => {
    const runner = fakeRunner();
    answer(runner, 1, "");

    await expect(issueLabels(runner, ROOT, "#1004")).resolves.toBeUndefined();
  });

  it("returns undefined when gh prints something that is not JSON", async () => {
    const runner = fakeRunner();
    answer(runner, 0, "not json");

    await expect(issueLabels(runner, ROOT, "#1004")).resolves.toBeUndefined();
  });

  it("returns undefined when the reply has no labels list", async () => {
    const runner = fakeRunner();
    answer(runner, 0, '{"title":"x"}');

    await expect(issueLabels(runner, ROOT, "#1004")).resolves.toBeUndefined();
  });
});

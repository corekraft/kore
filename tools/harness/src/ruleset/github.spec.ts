import { describe, expect, it } from "vitest";
import { RulesetError } from "./declared.js";
import { GitHubError, GitHubRulesets, PAGE } from "./github.js";
import { REPO, fakeRunner } from "./ruleset-support.js";

const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
const api = (...args: string[]) => ["gh", ["api", ...args], {}] as const;

/** A client over a fake runner, with the answers given in call order. */
function clientAnswering(...answers: ReturnType<typeof ok>[]) {
  const runner = fakeRunner();
  for (const answer of answers) {
    runner.run.mockResolvedValueOnce(answer);
  }
  return { runner, github: new GitHubRulesets(runner, REPO) };
}

describe("find reads the live ruleset with the given name, in full", () => {
  it("lists the rulesets, then fetches the matching one by id", async () => {
    const { runner, github } = clientAnswering(
      ok('[{"id":7,"name":"main"},{"id":8,"name":"main-candidate"}]'),
      ok('{"id":8,"name":"main-candidate","rules":[]}'),
    );
    expect(await github.find("main-candidate")).toEqual({
      id: 8,
      name: "main-candidate",
      rules: [],
    });
    expect(runner.run.mock.calls).toEqual([
      api(`repos/${REPO}/rulesets`),
      api(`repos/${REPO}/rulesets/8`),
    ]);
  });

  it("returns undefined without a second read when no ruleset has the name", async () => {
    const { runner, github } = clientAnswering(ok('[{"id":7,"name":"main"}]'));
    expect(await github.find("main-candidate")).toBeUndefined();
    expect(runner.run.mock.calls).toEqual([api(`repos/${REPO}/rulesets`)]);
  });

  it("refuses a listing that is not a list, naming the repository to check", async () => {
    const { github } = clientAnswering(ok('{"message":"Not Found"}'));
    await expect(github.find("main")).rejects.toThrow(
      `gh api repos/${REPO}/rulesets did not return a list. Check that ${REPO} is an owner/name repository you can read.`,
    );
  });
});

describe("save creates or updates one ruleset with the body on stdin", () => {
  const body = { name: "main", rules: [] };

  it("posts a new ruleset when there is no id", async () => {
    const { runner, github } = clientAnswering(ok(""));
    await github.save(undefined, body);
    expect(runner.run.mock.calls).toEqual([
      [
        "gh",
        ["api", "-X", "POST", `repos/${REPO}/rulesets`, "--input", "-"],
        { input: JSON.stringify(body) },
      ],
    ]);
  });

  it("puts over the ruleset with the given id", async () => {
    const { runner, github } = clientAnswering(ok(""));
    await github.save(8, body);
    expect(runner.run.mock.calls).toEqual([
      [
        "gh",
        ["api", "-X", "PUT", `repos/${REPO}/rulesets/8`, "--input", "-"],
        { input: JSON.stringify(body) },
      ],
    ]);
  });
});

describe("suites and suite read rule evaluations for insights", () => {
  it("lists the suites of one period, one page at a time", async () => {
    const { runner, github } = clientAnswering(ok("[]"));
    expect(await github.suites("week")).toEqual([]);
    expect(runner.run.mock.calls).toEqual([
      api(
        `repos/${REPO}/rulesets/rule-suites?time_period=week&per_page=${PAGE}`,
      ),
    ]);
  });

  it("reads one suite by id", async () => {
    const { runner, github } = clientAnswering(ok('{"id":3}'));
    expect(await github.suite(3)).toEqual({ id: 3 });
    expect(runner.run.mock.calls).toEqual([
      api(`repos/${REPO}/rulesets/rule-suites/3`),
    ]);
  });

  it("reads an empty answer as an empty object", async () => {
    const { github } = clientAnswering(ok("   "));
    expect(await github.suite(3)).toEqual({});
  });

  it("refuses a suite list that is not a list", async () => {
    const { github } = clientAnswering(ok("{}"));
    await expect(github.suites("day")).rejects.toThrow("did not return a list");
  });
});

describe("a failed gh call names the command and the fix", () => {
  it("throws a GitHubError with gh's stderr and the repository to check", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce({
      stdout: "",
      stderr: "HTTP 404\n",
      code: 1,
    });
    const github = new GitHubRulesets(runner, REPO);
    const failed = github.suites("week");
    await expect(failed).rejects.toBeInstanceOf(GitHubError);
    await expect(failed).rejects.toThrow(
      `gh api repos/${REPO}/rulesets/rule-suites?time_period=week&per_page=${PAGE} failed: HTTP 404. Check \`gh auth status\` and that you may administer ${REPO}.`,
    );
  });

  it("keeps the stderr on the error and says the exit code when stderr is empty", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce({ stdout: "", stderr: "", code: 4 });
    const error = await new GitHubRulesets(runner, REPO)
      .suite(1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).stderr).toBe("");
    expect((error as GitHubError).message).toMatch(/failed: exit 4\./);
  });

  it("is a ruleset error, so the command reports it as an expected failure", async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce({ stdout: "", stderr: "x", code: 1 });
    await expect(new GitHubRulesets(runner, REPO).suite(1)).rejects.toThrow(
      RulesetError,
    );
  });

  it("says to check gh when a successful call prints no JSON, quoting the start of it", async () => {
    const { github } = clientAnswering(ok("not json at all"));
    await expect(github.suite(2)).rejects.toThrow(
      `gh api repos/${REPO}/rulesets/rule-suites/2 did not return JSON: not json at all. Check \`gh --version\` and \`gh auth status\`, then rerun.`,
    );
  });
});

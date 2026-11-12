import { describe, expect, it } from "vitest";
import { committedInventoryText } from "../testing/guardrail-support.js";
import { auditEvents, bash, guard } from "./guard-modes-support.js";

const PATH = "/repo/.github/rulesets/main.json";
const ruleset = (change: object = {}) =>
  JSON.stringify(
    {
      name: "main",
      target: "branch",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
      rules: [
        { type: "deletion" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
            require_code_owner_review: true,
          },
        },
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "check" }] },
        },
      ],
      bypass_actors: [{ actor_id: 1, actor_type: "User" }],
      ...change,
    },
    null,
    2,
  );
const write = (content: string) => ({
  session_id: "s1",
  tool_name: "Write",
  tool_input: { file_path: PATH, content },
});
const edit = (oldS: string, newS: string) => ({
  session_id: "s1",
  tool_name: "Edit",
  tool_input: { file_path: PATH, old_string: oldS, new_string: newS },
});
const run = (payload: unknown) =>
  guard(payload, committedInventoryText, "/repo", { [PATH]: ruleset() });

const rules = (...r: object[]) => ruleset({ rules: r });
const pr = (params: object) => ({ type: "pull_request", parameters: params });
const checks = (...contexts: string[]) => ({
  type: "required_status_checks",
  parameters: {
    required_status_checks: contexts.map((context) => ({ context })),
  },
});

describe("the declared main ruleset is guarded against weakening", () => {
  it.each([
    [
      "a removed rule",
      write(rules({ type: "deletion" }, checks("check"))),
      /pull_request/,
    ],
    [
      "a lowered review count",
      edit(
        '"required_approving_review_count": 1',
        '"required_approving_review_count": 0',
      ),
      /required_approving_review_count/,
    ],
    [
      "a turned-off requirement",
      edit(
        '"require_code_owner_review": true',
        '"require_code_owner_review": false',
      ),
      /require_code_owner_review/,
    ],
    [
      "a dropped required check",
      write(
        rules(
          { type: "deletion" },
          pr({
            required_approving_review_count: 1,
            require_code_owner_review: true,
          }),
          checks(),
        ),
      ),
      /required_status_checks/,
    ],
    [
      "a new bypass actor",
      write(
        ruleset({
          bypass_actors: [
            { actor_id: 1, actor_type: "User" },
            { actor_id: 2, actor_type: "Team" },
          ],
        }),
      ),
      /bypass_actors/,
    ],
    ["a changed target", write(ruleset({ target: "tag" })), /target changes/],
    [
      "a dropped target",
      write(ruleset({ target: undefined })),
      /target changes/,
    ],
    ["a file that is no longer JSON", write("{ not json"), /JSON/],
  ])("warns, naming what weakens, on %s", async (_, payload, named) => {
    const result = await run(payload);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(named);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "guardrail-demotion" },
    ]);
  });
});

describe("the declared main ruleset is not warned on for tightening", () => {
  it.each([
    [
      "a new rule",
      write(
        ruleset({
          rules: [
            ...JSON.parse(ruleset()).rules,
            { type: "required_linear_history" },
          ],
        }),
      ),
    ],
    [
      "a higher review count",
      edit(
        '"required_approving_review_count": 1',
        '"required_approving_review_count": 2',
      ),
    ],
    [
      "an added required check",
      write(
        rules(
          { type: "deletion" },
          pr({
            required_approving_review_count: 1,
            require_code_owner_review: true,
          }),
          checks("check", "scan"),
        ),
      ),
    ],
    ["a rewrite that changes nothing", write(ruleset())],
  ])("stays silent on %s", async (_, payload) => {
    const result = await run(payload);
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });

  it("warns on a command that rewrites a declared ruleset", async () => {
    const result = await run(
      bash("sed -i 's/true/false/' .github/rulesets/main.json"),
    );
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/\.github\/rulesets\/main\.json/);
  });

  it("does not guard other JSON files under .github", async () => {
    const result = await run(bash("sed -i 's/a/b/' .github/other/main.json"));
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });
});

describe("a live ruleset change is guarded", () => {
  const sync = (flags: string) =>
    `node skills/bin/harness.mjs ruleset sync --repo corekraft/kore --target main ${flags}`;

  it.each(["--confirm", "--dry-run --confirm", "--confirm --allow-removal"])(
    "warns on ruleset sync %s",
    async (flags) => {
      const result = await run(bash(sync(flags)));
      expect(result.code).toBe(0);
      expect(result.out).toMatch(/guard:guardrail-demotion/);
      expect(result.out).toMatch(/operator/);
    },
  );

  it("stays silent on a dry run, which mutates nothing", async () => {
    const result = await run(bash(sync("--dry-run")));
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });
});

describe("a declared ruleset that does not exist yet", () => {
  it("is not warned on when first written", async () => {
    const result = await guard(
      write(ruleset()),
      committedInventoryText,
      "/repo",
    );
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });
});

describe("the guard and sync call the same things a weakening", () => {
  const withMerge = (methods: string[]) =>
    ruleset({
      rules: [
        {
          type: "pull_request",
          parameters: { allowed_merge_methods: methods },
        },
      ],
    });

  it("warns when an edit adds a merge method", async () => {
    const result = await guard(
      write(withMerge(["squash", "merge"])),
      committedInventoryText,
      "/repo",
      { [PATH]: withMerge(["squash"]) },
    );
    expect(result.out).toMatch(/allowed_merge_methods gains an entry/);
  });

  it("stays silent when an edit removes a merge method", async () => {
    const result = await guard(
      write(withMerge(["squash"])),
      committedInventoryText,
      "/repo",
      { [PATH]: withMerge(["squash", "merge"]) },
    );
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });
});

import { describe, expect, it } from "vitest";
import { committedInventoryText } from "../testing/guardrail-support.js";
import { guard } from "./guard-modes-support.js";

const PATH = "/repo/.github/rulesets/main.json";
const ruleset = (mode: string) =>
  JSON.stringify({
    name: "main",
    target: "branch",
    rules: [{ type: "deletion" }],
    bypass_actors: [{ actor_id: 1, actor_type: "User", bypass_mode: mode }],
  });
const write = (mode: string) => ({
  session_id: "s1",
  tool_name: "Write",
  tool_input: { file_path: PATH, content: ruleset(mode) },
});
const run = (payload: unknown) =>
  guard(payload, committedInventoryText, "/repo", {
    [PATH]: ruleset("pull_request"),
  });

describe("the guard hook ranks bypass modes", () => {
  it("warns when a bypass mode widens to always", async () => {
    const result = await run(write("always"));
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/bypass_mode widens/);
  });

  it("stays silent on a rewrite that changes nothing", async () => {
    const result = await run(write("pull_request"));
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });

  it("stays silent when a bypass narrows from always", async () => {
    const result = await guard(
      write("pull_request"),
      committedInventoryText,
      "/repo",
      { [PATH]: ruleset("always") },
    );
    expect(result.out).not.toMatch(/guardrail-demotion/);
  });
});

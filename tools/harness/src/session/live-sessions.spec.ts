import { expect, it } from "vitest";
import { fakeRunner } from "./deps-support.js";
import { liveSessionCount } from "./live-sessions.js";

const listing = (agents: unknown) => JSON.stringify({ result: { agents } });

it("counts the agents herdr lists", async () => {
  const runner = fakeRunner();
  runner.run.mockResolvedValue({
    code: 0,
    stdout: listing([{ pane_id: "w3:p1" }, { pane_id: "w3:p2" }]),
    stderr: "",
  });

  expect(await liveSessionCount(runner)).toBe(2);
  expect(runner.run.mock.calls).toEqual([["herdr", ["agent", "list"]]]);
});

it("counts an empty listing as zero", async () => {
  const runner = fakeRunner();
  runner.run.mockResolvedValue({ code: 0, stdout: listing([]), stderr: "" });

  expect(await liveSessionCount(runner)).toBe(0);
});

it.each([
  ["a failing herdr", { code: 1, stdout: "", stderr: "down" }],
  ["output that is not JSON", { code: 0, stdout: "oops", stderr: "" }],
  ["output with no agent list", { code: 0, stdout: "{}", stderr: "" }],
])("reads %s as unknown, never as zero", async (_name, result) => {
  const runner = fakeRunner();
  runner.run.mockResolvedValue(result);

  expect(await liveSessionCount(runner)).toBeUndefined();
});

it("reads a herdr that cannot start as unknown", async () => {
  const runner = fakeRunner();
  runner.run.mockRejectedValue(new Error("spawn ENOENT"));

  expect(await liveSessionCount(runner)).toBeUndefined();
});

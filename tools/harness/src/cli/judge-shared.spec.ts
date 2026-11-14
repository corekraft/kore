import { describe, expect, it, vi } from "vitest";
import { JudgeError } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { failed, FAILED } from "./judge-shared.js";

function contextOf(json: boolean) {
  const stderr = vi.fn();
  const context = { json, deps: { stderr } } as unknown as CommandContext;
  return { context, stderr };
}

describe("judge failed", () => {
  it("reports a judge error on stderr and returns the failing exit code", () => {
    const { context, stderr } = contextOf(false);
    expect(failed(context, new JudgeError("boom"))).toBe(FAILED);
    expect(stderr).toHaveBeenCalledWith("boom\n");
  });

  it("writes the error as a JSON line before the message under --json", () => {
    const { context, stderr } = contextOf(true);
    expect(failed(context, new JudgeError("boom"))).toBe(FAILED);
    expect(stderr).toHaveBeenCalledWith('{"error":"boom"}\nboom\n');
  });

  it("rethrows an error that is not a judge error, so a bug is never reported as an expected failure", () => {
    const { context, stderr } = contextOf(false);
    const bug = new Error("bug");
    expect(() => failed(context, bug)).toThrow(bug);
    expect(stderr).not.toHaveBeenCalled();
  });
});

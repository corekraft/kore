import { describe, expect, it } from "vitest";
import { GuardrailError } from "../guardrail/index.js";
import { RulesetError } from "./declared.js";
import { destination, guarded } from "./support.js";
import { REPO, fakeContext, fakeDeps } from "./ruleset-support.js";

describe("guarded returns the action's exit code", () => {
  it("returns what the action resolves to, writing nothing", async () => {
    const deps = fakeDeps();
    expect(await guarded(fakeContext({}, deps), () => Promise.resolve(0))).toBe(
      0,
    );
    expect(deps.stderr).not.toHaveBeenCalled();
  });
});

describe("guarded reports an expected error as one stderr line and exits 1", () => {
  it.each([
    ["a ruleset error", new RulesetError("main would weaken")],
    ["a guardrail error", new GuardrailError("inventory is missing")],
  ])("prints the message of %s on stderr", async (_name, error) => {
    const deps = fakeDeps();
    const code = await guarded(fakeContext({}, deps), () =>
      Promise.reject(error),
    );
    expect(code).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([[`${error.message}\n`]]);
  });

  it("prints one json object with an error field when the context asks for json", async () => {
    const deps = fakeDeps();
    const error = new RulesetError("main would weaken");
    const context = fakeContext({}, deps, true);
    expect(await guarded(context, () => Promise.reject(error))).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      [`${JSON.stringify({ error: "main would weaken" })}\n`],
    ]);
  });

  it("rethrows an error that is neither a ruleset nor a guardrail error", async () => {
    const deps = fakeDeps();
    const bug = new TypeError("undefined is not a function");
    const failed = guarded(fakeContext({}, deps), () => Promise.reject(bug));
    await expect(failed).rejects.toBe(bug);
    expect(deps.stderr).not.toHaveBeenCalled();
  });
});

describe("destination reads the repository and the ruleset a command names", () => {
  it("returns the trimmed repository and target", () => {
    const context = fakeContext({ repo: ` ${REPO} `, target: " main " });
    expect(destination(context)).toEqual({ repo: REPO, target: "main" });
  });

  it.each([
    ["repo", { target: "main" }],
    ["target", { repo: REPO }],
    ["repo", { repo: "   ", target: "main" }],
    ["target", { repo: REPO, target: true }],
  ])("refuses without --%s and names the flag to pass", (flag, options) => {
    expect(() => destination(fakeContext(options))).toThrow(
      new RegExp(`^Missing --${flag}: a ruleset change names its`),
    );
  });

  it("names the ruleset it refuses to default", () => {
    expect(() => destination(fakeContext({ repo: REPO }))).toThrow(
      "Missing --target: a ruleset change names its ruleset, by name, the target explicitly, never a default. Rerun with --target <value>.",
    );
  });
});

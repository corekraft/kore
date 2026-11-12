import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { CommandError } from "../runtime/index.js";
import { hookCommand, readPayload } from "./io.js";

async function runHook(
  handler: Parameters<typeof hookCommand>[2],
  stdin = "",
  options: Record<string, string | boolean> = {},
) {
  const h = testHarness();
  h.deps.stdin = () => Promise.resolve(stdin);
  const code = await hookCommand("demo", "demo hook", handler).run({
    json: false,
    options,
    deps: h.deps,
  });
  return { code, out: h.out(), err: h.err() };
}

describe("hook I/O", () => {
  it("hands the handler the JSON the host sent on stdin", async () => {
    let seen: unknown;
    await runHook((c) => {
      seen = c.payload;
      return Promise.resolve({});
    }, '{"tool_name":"Bash"}');
    expect(seen).toEqual({ tool_name: "Bash" });
  });

  it("treats empty or malformed stdin as no payload", async () => {
    const h = testHarness();
    for (const text of ["", "  \n", "not json"]) {
      h.deps.stdin = () => Promise.resolve(text);
      expect(await readPayload(h.deps)).toBeUndefined();
    }
  });

  it("passes the handler's exit code, stdout and stderr through", async () => {
    expect(
      await runHook(() =>
        Promise.resolve({ code: 2, stdout: "a\n", stderr: "b\n" }),
      ),
    ).toEqual({ code: 2, out: "a\n", err: "b\n" });
  });

  it("exits 0 and prints nothing when the handler has nothing to say", async () => {
    expect(await runHook(() => Promise.resolve({}))).toEqual({
      code: 0,
      out: "",
      err: "",
    });
  });

  it("fails open on an expected error, naming the hook and the cause", async () => {
    const result = await runHook(() =>
      Promise.reject(new CommandError("no skills directory")),
    );
    expect(result).toEqual({
      code: 0,
      out: "",
      err: "[hook:demo] failed open: no skills directory\n",
    });
  });

  it("exits 1 on a fault under --strict, so a check never passes unrun", async () => {
    const result = await runHook(
      () => Promise.reject(new CommandError("no skills directory")),
      "",
      { strict: true },
    );
    expect(result.code).toBe(1);
    expect(result.err).toBe("[hook:demo] failed open: no skills directory\n");
  });

  it("fails open on an unexpected error and says the fault is the harness's", async () => {
    const result = await runHook(() => Promise.reject(new TypeError("boom")));
    expect(result.code).toBe(0);
    expect(result.err).toBe(
      "[hook:demo] failed open: boom (unexpected; fixing it is on the harness)\n",
    );
  });

  it("fails open on a thrown non-error value", async () => {
    const result = await runHook(() => Promise.reject("odd"));
    expect(result.err).toMatch(/failed open: odd/);
  });
});

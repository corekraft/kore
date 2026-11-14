// Feedback hook, stop mode.

import { describe, expect, it } from "vitest";
import { hookFeedback } from "../../src/testing/index.js";

const { failing, hook, lines, marked } = hookFeedback;

describe("hook feedback stop", () => {
  it("costs nothing when no TypeScript changed", async () => {
    const result = await hook("stop", { session_id: "s1" });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it("typechecks after TypeScript changed and clears the marker on success", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1" },
      { marked: ["kore"] },
    );
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      ["npm", "--prefix", "tools/kore", "run", "check", "--silent"],
    ]);
    expect(marked(result.files, "ts")).toBe(false);
  });

  it("runs no tests when both projects changed: the full suites belong to CI, related tests to the commit hook", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1" },
      { marked: ["kore", "harness"] },
    );
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      ["npm", "--prefix", "tools/kore", "run", "check", "--silent"],
      ["npm", "--prefix", "tools/harness", "run", "check", "--silent"],
    ]);
    for (const call of result.calls) {
      expect(call.join(" ")).not.toMatch(/vitest|test/);
    }
  });

  it("blocks ending the turn on a type error and keeps the marker", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1" },
      { marked: ["kore"], responses: [failing("npm", "TS2322", 2)] },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "Typecheck failed after your TypeScript changes. Fix it before finishing.\nTS2322\n",
    );
    expect(marked(result.files, "ts")).toBe(true);
  });

  it("does not loop when the host is already continuing from a stop hook", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1", stop_hook_active: true },
      { marked: ["kore", "harness"], responses: [failing("npm", "TS2322", 2)] },
    );
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("bounds a large typecheck report", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1" },
      { marked: ["kore"], responses: [failing("npm", lines(500), 2)] },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      `Typecheck failed after your TypeScript changes. Fix it before finishing.\n${lines(40)}\n... 460 more lines cut. Run \`npm --prefix tools/kore run check\` to see all.\n`,
    );
  });
});

describe("hook feedback stop on harness sources", () => {
  it("typechecks the harness and clears its marker on success", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1" },
      { marked: ["harness"] },
    );
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      ["npm", "--prefix", "tools/harness", "run", "check", "--silent"],
    ]);
    expect(marked(result.files, "harness")).toBe(false);
  });

  it("blocks on a harness type error naming the harness and keeps its marker", async () => {
    const result = await hook(
      "stop",
      { session_id: "s1" },
      { marked: ["harness"], responses: [failing("npm", "TS2322", 2)] },
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "The harness typecheck failed after your TypeScript changes. Fix it before finishing.\nTS2322\n",
    );
    expect(marked(result.files, "harness")).toBe(true);
  });
});

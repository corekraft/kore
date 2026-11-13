import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { startAgent } from "./agent-start.js";
import { herdrCalls, sequence } from "./spawn-support.js";

const START = ["agent", "start", "image-trust-writer"];
const isStart = (_c: string, a: readonly string[]) => a[1] === "start";
const failure = (n: number) => ({ code: 1, stderr: `start failure ${n}` });

describe("startAgent retries a failed agent start", () => {
  it("returns no error once a later try starts the agent", async () => {
    const h = testHarness({
      responses: [sequence(isStart, failure(1), failure(2), {})],
    });
    expect(await startAgent(h.deps, START)).toBeUndefined();
    expect(herdrCalls(h)).toHaveLength(3);
  });

  it("retries a start failure that is not agent_pane_busy", async () => {
    const h = testHarness({
      responses: [sequence(isStart, { code: 1, stderr: "pane not ready" }, {})],
    });
    expect(await startAgent(h.deps, START)).toBeUndefined();
    expect(herdrCalls(h)).toHaveLength(2);
  });

  it("makes ten tries one second apart, then reports the last error", async () => {
    const h = testHarness({
      responses: [
        sequence(
          isStart,
          ...Array.from({ length: 10 }, (_, i) => failure(i + 1)),
        ),
      ],
    });
    const began = h.deps.clock.now().getTime();
    const error = await startAgent(h.deps, START);
    expect(herdrCalls(h)).toHaveLength(10);
    expect(h.deps.clock.now().getTime() - began).toBe(9_000);
    expect(error).toContain("after 10 tries");
    expect(error).toContain("start failure 10");
    expect(error).not.toContain("start failure 9");
  });
});

import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import { herdrCalls } from "./spawn-support.js";

const SESSION = {
  HERDR_ENV: "1",
  HERDR_PANE_ID: "w3:p9",
  KORE_AGENT: "image-trust-writer",
};
const LINE =
  "[herdr:image-trust-writer] finished: RESULT done; summary in pane w3:p9";
const notify = ["session", "notify", "w3:p1", "--outcome", "done"];
const delivered = (_c: string, a: readonly string[]) =>
  a[0] === "pane" && a[1] === "read";

describe("session notify", () => {
  it("sends the finish line to the caller pane, submits it, then confirms the line shows there", async () => {
    const h = testHarness({
      env: SESSION,
      responses: [
        { match: delivered, result: { code: 0, stdout: `> ${LINE}\n` } },
      ],
    });
    expect(await run(notify, h.deps)).toBe(0);
    expect(herdrCalls(h)).toEqual([
      `herdr pane send-text w3:p1 ${LINE}`,
      "herdr pane send-keys w3:p1 enter",
      "herdr pane read w3:p1 --source recent-unwrapped",
    ]);
    expect(h.out()).toBe(
      "Notified w3:p1: image-trust-writer finished: RESULT done.\n",
    );
  });

  it("refuses an outcome other than done or blocked before sending anything", async () => {
    const h = testHarness({ env: SESSION });
    expect(
      await run(["session", "notify", "w3:p1", "--outcome", "merged"], h.deps),
    ).toBe(2);
    expect(h.err()).toContain("done or blocked");
    expect(herdrCalls(h)).toEqual([]);
  });

  it("refuses a caller pane that is not a pane id before sending anything", async () => {
    const h = testHarness({ env: SESSION });
    expect(
      await run(["session", "notify", "w3:p1;rm", "--outcome", "done"], h.deps),
    ).toBe(2);
    expect(herdrCalls(h)).toEqual([]);
  });

  it("refuses to run outside a spawned session before sending anything", async () => {
    const h = testHarness({ env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p9" } });
    expect(await run(notify, h.deps)).toBe(1);
    expect(h.err()).toContain("KORE_AGENT");
    expect(herdrCalls(h)).toEqual([]);
  });

  it("fails naming the caller pane when the line never shows there", async () => {
    const h = testHarness({
      env: SESSION,
      responses: [{ match: delivered, result: { code: 0, stdout: "" } }],
    });
    expect(await run(notify, h.deps)).toBe(1);
    expect(h.err()).toContain("w3:p1");
    expect(h.err()).toContain("not confirmed");
    expect(
      herdrCalls(h).filter((c) => c.startsWith("herdr pane read")),
    ).toHaveLength(3);
  });
});

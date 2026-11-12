import { describe, expect, it } from "vitest";
import type { FakeResponse } from "../runtime/runner-support.js";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  spawnArgs,
  splitReturns,
} from "./spawn-support.js";

const SEND_ENTER = "herdr agent send-keys image-trust-writer enter";
const WAIT_WORKING =
  "herdr agent wait image-trust-writer --until working --timeout 5000";

const promptNotSubmitted: FakeResponse = {
  match: (c, a) => c === "herdr" && a[1] === "prompt",
  result: { code: 1, stderr: "timed out waiting for working" },
};
const waitFails: FakeResponse = {
  match: (c, a) => c === "herdr" && a[1] === "wait",
  result: { code: 1, stderr: "timed out waiting for working" },
};
const base = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];

describe("session spawn brief submission", () => {
  it("presses enter once and waits for working when the pasted brief did not submit", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [promptNotSubmitted, ...base],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    const calls = herdrCalls(h);
    const prompt = calls.findIndex((c) => c.startsWith("herdr agent prompt"));
    expect(calls.slice(prompt + 1, prompt + 3)).toEqual([
      SEND_ENTER,
      WAIT_WORKING,
    ]);
    expect(calls.filter((c) => c === SEND_ENTER)).toHaveLength(1);
  });

  it("sends no extra enter when the brief submits on the first attempt", async () => {
    const h = testHarness({ env: INSIDE, responses: base });
    expect(await run(spawnArgs, h.deps)).toBe(0);
    expect(herdrCalls(h)).not.toContain(SEND_ENTER);
    expect(herdrCalls(h)).not.toContain(WAIT_WORKING);
  });

  it("fails naming the prompt and the enter retry when the brief still does not submit", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [promptNotSubmitted, waitFails, ...base],
    });
    expect(await run(spawnArgs, h.deps)).toBe(1);
    expect(h.err()).toBe(
      "herdr agent prompt failed: timed out waiting for working; pressing enter did not start it either: timed out waiting for working. Session image-trust-writer is running in pane w3:p9 without its brief.\n",
    );
  });
});

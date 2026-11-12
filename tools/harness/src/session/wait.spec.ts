import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  screen,
  sequence,
  spawnArgs,
  splitReturns,
  stateFile,
} from "./spawn-support.js";

const isRead = (_c: string, a: readonly string[]) =>
  a[0] === "pane" && a[1] === "read";
const record = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const files = { [stateFile("image-trust-writer")]: JSON.stringify(record) };
const wait = ["session", "wait", "image-trust-writer", "--json"];

describe("session wait", () => {
  it("returns session name, pane id, model, outcome word and summary location as JSON", async () => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [gitCommon, screen("All green.\n  RESULT: blocked  \n")],
    });
    expect(await run(wait, h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      name: "image-trust-writer",
      paneId: "w3:p9",
      model: "claude-sonnet-5-5",
      outcome: "blocked",
      summary: "pane w3:p9",
    });
  });

  it("accepts the marker as the first line of an assistant message, after Claude's bullet", async () => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [gitCommon, screen("● RESULT: done\n")],
    });
    expect(await run(wait, h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({ outcome: "done" });
  });

  it("reads the unwrapped pane text so a wrapped line cannot split the marker", async () => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [gitCommon, screen("RESULT: done")],
    });
    await run(wait, h.deps);
    expect(herdrCalls(h)).toContain(
      "herdr pane read w3:p9 --source recent-unwrapped",
    );
  });
});

describe("session wait refusals and recording", () => {
  it("keeps waiting while the brief merely mentions the marker words, and ends only on an anchored line", async () => {
    const brief = [
      "❯ Print a final line with the word RESULT, a colon, then done or blocked.",
      "  Or write RESULT: done or RESULT: blocked inside a sentence",
      '  herdr pane send-text w3:p1 "[herdr:image-trust-writer] finished: RESULT <done|blocked>; summary in pane $HERDR_PANE_ID"',
    ].join("\n");
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [
        gitCommon,
        sequence(
          isRead,
          { stdout: brief },
          { stdout: brief },
          { stdout: `${brief}\nRESULT: done\n` },
        ),
      ],
    });
    expect(await run(wait, h.deps)).toBe(0);
    expect(herdrCalls(h).filter((c) => c.includes("pane read"))).toHaveLength(
      3,
    );
    expect(JSON.parse(h.out())).toMatchObject({ outcome: "done" });
  });

  it("fails naming the timeout when only the brief is ever on screen", async () => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [gitCommon, screen("then RESULT: done or blocked, please")],
    });
    expect(await run([...wait, "--timeout", "5000"], h.deps)).toBe(1);
    expect(h.err()).toContain("RESULT");
    expect(h.err()).toContain("5 seconds");
    expect(h.err()).toContain("w3:p9");
  });

  it("rejects a timeout that is not a positive number of milliseconds", async () => {
    const h = testHarness({ env: INSIDE, files, responses: [gitCommon] });
    expect(await run([...wait, "--timeout", "soon"], h.deps)).toBe(2);
    expect(h.err()).toContain("--timeout");
    expect(herdrCalls(h)).toEqual([]);
  });

  it("fails naming herdr's message when the pane cannot be read", async () => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [
        gitCommon,
        { match: isRead, result: { code: 1, stderr: "pane_not_found" } },
      ],
    });
    expect(await run(wait, h.deps)).toBe(1);
    expect(h.err()).toContain("pane_not_found");
  });

  it("names the fix when no session by that name was spawned by this tool", async () => {
    const h = testHarness({ env: INSIDE, responses: [gitCommon] });
    expect(await run(wait, h.deps)).toBe(1);
    expect(h.err()).toContain("image-trust-writer");
    expect(h.err()).toContain("session spawn");
  });
});

describe("session wait arguments", () => {
  it("rejects a second positional argument", async () => {
    const h = testHarness({ env: INSIDE, files, responses: [gitCommon] });
    expect(await run(["session", "wait", "a-b", "c-d"], h.deps)).toBe(2);
    expect(h.err()).toContain('Unexpected argument "c-d"');
  });

  it("requires the session name", async () => {
    const h = testHarness({ env: INSIDE });
    expect(await run(["session", "wait"], h.deps)).toBe(2);
    expect(h.err()).toContain("session name");
  });
});

describe("session wait recording", () => {
  it("records the result so close can proceed and a repeated wait does not read the pane", async () => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [gitCommon, screen("RESULT: done")],
    });
    await run(wait, h.deps);
    const stored = JSON.parse(
      h.files.get(stateFile("image-trust-writer")) ?? "null",
    ) as { result: { outcome: string } };
    expect(stored.result.outcome).toBe("done");
    const reads = herdrCalls(h).length;
    expect(await run(wait, h.deps)).toBe(0);
    expect(herdrCalls(h)).toHaveLength(reads);
  });

  it("works later on a --no-wait session, so several sessions run in parallel", async () => {
    const responses = (pane: string) => [
      gitCommon,
      nameFree,
      layoutOf(),
      splitReturns(pane),
      screen("RESULT: done"),
    ];
    const h = testHarness({ env: INSIDE, responses: responses("w3:p9") });
    await run(spawnArgs, h.deps);
    const second = spawnArgs.map((a) =>
      a === "image-trust-writer" ? "gateway-tls-writer" : a,
    );
    await run(second, h.deps);
    expect(
      await run(["session", "wait", "image-trust-writer", "--json"], h.deps),
    ).toBe(0);
    expect(
      await run(["session", "wait", "gateway-tls-writer", "--json"], h.deps),
    ).toBe(0);
  });
});

describe("session wait name validation", () => {
  it.each(["Bad Name", "../escape", "a/b"])(
    "rejects the name %j before touching git or the registry",
    async (name) => {
      const h = testHarness({ env: INSIDE, responses: [gitCommon] });
      expect(await run(["session", "wait", name], h.deps)).toBe(2);
      expect(h.err()).toContain("Session name");
      expect(h.runner.calls).toEqual([]);
    },
  );
});

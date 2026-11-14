import { describe, expect, it } from "vitest";
import { testHarness } from "../../src/testing/index.js";
import { run } from "../../src/cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  splitReturns,
} from "./spawn-support.js";

const definition = (model: string, effort: string) =>
  `---\nname: reader\ndescription: x\nmodel: ${model}\neffort: ${effort}\ntools: Read\n---\nBody.\n`;

const argv = (...extra: string[]) => [
  "session",
  "spawn",
  "--role",
  "reader",
  "--name",
  "image-trust-reader",
  "--brief",
  "Summarize.",
  "--no-wait",
  ...extra,
];

const responses = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];

describe("session spawn tier", () => {
  it("launches a role at the model and effort its definition declares, with no flags", async () => {
    const h = testHarness({
      env: INSIDE,
      responses,
      files: {
        "/repo/.claude/agents/reader.md": definition("claude-haiku-5-5", "low"),
      },
    });
    expect(await run(argv(), h.deps)).toBe(0);
    expect(herdrCalls(h)).toContain(
      "herdr agent start image-trust-reader --kind claude --pane w3:p9 -- --agent reader --model claude-haiku-5-5 --effort low",
    );
  });

  it("lets an explicit flag override the definition, which is how a writer escalates", async () => {
    const h = testHarness({
      env: INSIDE,
      responses,
      files: {
        "/repo/.claude/agents/reader.md": definition("claude-haiku-5-5", "low"),
      },
    });
    expect(await run(argv("--model", "claude-sonnet-5-5"), h.deps)).toBe(0);
    expect(herdrCalls(h)).toContain(
      "herdr agent start image-trust-reader --kind claude --pane w3:p9 -- --agent reader --model claude-sonnet-5-5 --effort low",
    );
  });

  it("refuses before any herdr call when neither a flag nor the definition gives the model, naming the file to fix", async () => {
    const h = testHarness({ env: INSIDE });
    expect(await run(argv(), h.deps)).toBe(2);
    expect(h.err()).toContain("Missing --model");
    expect(h.err()).toContain(".claude/agents/reader.md");
    expect(h.runner.calls).toEqual([]);
  });

  it("refuses when the definition lacks an effort and none is given", async () => {
    const h = testHarness({
      env: INSIDE,
      files: {
        "/repo/.claude/agents/reader.md":
          "---\nname: reader\nmodel: claude-haiku-5-5\n---\n",
      },
    });
    expect(await run(argv(), h.deps)).toBe(2);
    expect(h.err()).toContain("Missing --effort");
    expect(h.runner.calls).toEqual([]);
  });

  it("does not read a definition for a role name that could escape the agents directory", async () => {
    const h = testHarness({
      env: INSIDE,
      files: { "/repo/evil.md": definition("claude-haiku-5-5", "low") },
    });
    const bad = argv().map((a) => (a === "reader" ? "../../evil" : a));
    expect(await run(bad, h.deps)).toBe(2);
    expect(h.runner.calls).toEqual([]);
  });
});

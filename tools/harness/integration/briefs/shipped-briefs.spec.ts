import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_SESSION_WAIT_LINE } from "../../src/hook/index.js";
import {
  branchNoticeBody,
  judgmentBrief,
  readerBrief,
  rebriefBrief,
  retroBrief,
} from "../../src/orchestrator/index.js";
import { buildBrief } from "../../src/session/index.js";
import { resamplerBrief, reviewerBrief } from "../../src/judge/index.js";

// The shipped text a session on hc reads: every agent definition, and every brief an hc session is started with or
// sent. The RESULT line and the terminal addresses belong to the herdr path until its flip (plan 16, Step 6), so an
// hc brief or definition that names either fails here. History (docs, ideas, retros) is not shipped text.
const ROOT = resolve(import.meta.dirname, "../../../..");
const AGENTS = join(ROOT, ".claude/agents");

const RESULT_LINE = /\bRESULT\b/;
const TERMINAL_ADDRESS = /t\d+|kore-agents\/t\d+|w\d+:p\d+/;

const AGENT_DEFINITIONS = readdirSync(AGENTS)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name): [string, string] => [
    `.claude/agents/${name}`,
    readFileSync(join(AGENTS, name), "utf8"),
  ]);

const HC_BRIEFS: [string, string][] = [
  [
    "a paired writer session's brief",
    buildBrief({
      task: "Do the thing.",
      name: "image-trust-writer",
      role: "writer",
      group: "pair-a",
    }),
  ],
  [
    "a reader session's brief",
    buildBrief({
      task: "Read it.",
      name: "reader-one",
      role: "reader",
    }),
  ],
  [
    "the judgment brief",
    judgmentBrief("0007", 873, 12, { kind: "start", sendBacks: 3 }),
  ],
  [
    "the reader brief",
    readerBrief("0007", 873, {
      question: "Which tests?",
      paths: ["tools/x.ts"],
    }),
  ],
  [
    "the writer re-brief",
    rebriefBrief("0007", 873, {
      brief: "Document the piece.",
      files: ["docs/a.md"],
    }),
  ],
  ["the retro brief", retroBrief("count")],
  ["the branch update notice", branchNoticeBody("conflict", 12)],
  [
    "the reviewer brief",
    reviewerBrief(12, "aaaaaaaa11111111aaaaaaaa11111111aaaaaaaa"),
  ],
  [
    "the re-review brief",
    resamplerBrief(12, "aaaaaaaa11111111aaaaaaaa11111111aaaaaaaa"),
  ],
  ["the main session's wait line", MAIN_SESSION_WAIT_LINE],
];

describe("the shipped agent definitions", () => {
  it.each(AGENT_DEFINITIONS)(
    "%s names no RESULT line and no terminal address",
    (_path, text) => {
      expect(text).not.toMatch(RESULT_LINE);
      expect(text).not.toMatch(TERMINAL_ADDRESS);
    },
  );
});

describe("the shipped briefs an hc session is given", () => {
  it.each(HC_BRIEFS)(
    "%s names no RESULT line and no terminal address",
    (_name, text) => {
      expect(text).not.toMatch(RESULT_LINE);
      expect(text).not.toMatch(TERMINAL_ADDRESS);
    },
  );

  it("tells an hc writer to finish with the full session report command", () => {
    expect(HC_BRIEFS[0]?.[1]).toContain(
      "run `node skills/bin/harness.mjs session report --outcome <done|blocked> --summary <your summary>`",
    );
  });
});

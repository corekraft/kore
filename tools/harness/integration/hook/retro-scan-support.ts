// Fixtures and builders shared by the retro-scan specs. Fixtures in
// .claude/hooks/fixtures/retro/ are synthetic.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
export const fixtures = `${repo}/.claude/hooks/fixtures/retro/`;

export const fixture = (name: string) => ({
  id: name,
  text: readFileSync(`${fixtures}${name}.jsonl`, "utf8"),
});
export const all = () => ["alpha", "bravo", "charlie"].map(fixture);
export const options = {
  since: "2026-10-31",
  knownSkills: ["handoff", "retro", "test-driven-development", "write-adr"],
  auditRules: ["image-digest", "sample-audit", "unquoted-glob"],
};

const STAMP = "2026-11-03T00:00:00.000Z";

/** A failed Bash call and its error result, as two JSONL lines. */
export const failure = (id: string, output: string): string[] => [
  JSON.stringify({
    type: "assistant",
    timestamp: STAMP,
    message: { content: [{ type: "tool_use", id, name: "Bash", input: {} }] },
  }),
  JSON.stringify({
    type: "user",
    timestamp: STAMP,
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          is_error: true,
          content: output,
        },
      ],
    },
  }),
];

export const human = (stamp: string, text: string): string =>
  JSON.stringify({
    type: "user",
    origin: { kind: "human" },
    timestamp: `2026-11-03T00:${stamp}:00.000Z`,
    message: { role: "user", content: text },
  });

export const toolTurn = (stamp: string, id: string, isError: boolean) =>
  [
    JSON.stringify({
      type: "assistant",
      timestamp: `2026-11-03T00:${stamp}:00.000Z`,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name: "Bash", input: {} }],
      },
    }),
    JSON.stringify({
      type: "user",
      timestamp: `2026-11-03T00:${stamp}:30.000Z`,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: isError ? "Exit code 1\nfatal: synthetic" : "ok",
            is_error: isError,
          },
        ],
      },
    }),
  ].join("\n");

export const twoSessions = (build: (id: string) => string) => [
  { id: "p", text: build("p") },
  { id: "q", text: build("q") },
];

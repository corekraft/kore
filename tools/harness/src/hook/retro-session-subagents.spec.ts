// In-process subagent launches one session shows: Agent tool calls and the
// agent definition each named. The transcript helpers are mocked.

import { beforeEach, expect, it, vi } from "vitest";
import { blocksOf, type Block } from "./retro-transcript.js";
import { session } from "./retro-session-support.js";
import type { TranscriptEvent } from "./retro-transcript.js";

vi.mock("./retro-transcript.js");

const { SessionAnalysis } = await import("./retro-session.js");

beforeEach(() => {
  vi.mocked(blocksOf).mockImplementation(
    (event) => (event.message?.content as Block[] | undefined) ?? [],
  );
});

const call = (
  line: number,
  name: string,
  input: Record<string, unknown>,
): TranscriptEvent => ({
  line,
  type: "assistant",
  message: { content: [{ type: "tool_use", id: `t${line}`, name, input }] },
});

it("records the agent definition each Agent call named, once per call", () => {
  const found = new SessionAnalysis(
    session([
      call(1, "Agent", { subagent_type: "principles-review" }),
      call(2, "Agent", { subagent_type: "principles-review" }),
      call(3, "Agent", { subagent_type: "writer" }),
    ]),
  );
  expect(found.subagents).toEqual([
    "principles-review",
    "principles-review",
    "writer",
  ]);
});

it("ignores other tools and Agent calls that name no agent definition", () => {
  const found = new SessionAnalysis(
    session([
      call(1, "Bash", { subagent_type: "writer" }),
      call(2, "Agent", { prompt: "x" }),
      call(3, "Agent", { subagent_type: "" }),
    ]),
  );
  expect(found.subagents).toEqual([]);
});

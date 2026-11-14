// The brief when a plan holds a `Last retrospective:` value that is not a marker.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { describe, expect, it } from "vitest";
import { brief } from "./context.js";
import { deps, frontmatter } from "./context-support.js";

describe("context brief with a malformed retrospective marker", () => {
  const journals = {
    local: [
      {
        ts: "2026-11-07T10:00:00.000Z",
        op: "a",
        kind: "start",
        command: "local up",
      },
      { ts: "2026-11-07T10:00:00.000Z", op: "a", kind: "end", outcome: "ok" },
    ],
  };
  // The marker is on line 11: six frontmatter lines, then the step.
  const plans = {
    "3-agent-harness.md": `${frontmatter("active")}## Step 1: Hooks\n\n- [ ] Ship it.\n\nLast retrospective: 2026-11-12 18:00:00Z\n`,
  };

  it("keeps the plan and environment lines and shows the marker error as a warning in place of the reminder", async () => {
    const counted: unknown[] = [];
    const context = await brief(
      { source: "startup", session_id: "s1" },
      deps({
        readPlans: () => Promise.resolve(plans),
        readJournals: () => Promise.resolve(journals),
        sessionsSince: (...call) => {
          counted.push(call);
          return Promise.resolve(5);
        },
      }),
    );
    expect(context).toBe(
      [
        "Session brief from infra/plans/3-agent-harness.md:",
        "Open items: Step 1 (1).",
        "Environment local: last operation `local up` ok on 2026-11-07.",
        'Warning: infra/plans/3-agent-harness.md:11: "2026-11-12 18:00:00Z" is not a retrospective marker; write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ',
      ].join("\n"),
    );
    expect(counted).toEqual([]);
  });
});

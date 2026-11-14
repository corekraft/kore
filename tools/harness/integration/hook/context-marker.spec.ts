// The brief when a plan holds a `Last retrospective:` value that is not a marker,
// run through the real hook over a real repository.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { afterEach, describe, expect, it } from "vitest";
import * as hookRun from "./hook-run-support.js";

const { additional, cleanTemps, context, frontmatter, repository } = hookRun;

afterEach(cleanTemps);

describe("context brief with a malformed retrospective marker", () => {
  it("keeps the plan and environment lines and shows the marker error as a warning in place of the reminder", async () => {
    // The marker is on line 11: six frontmatter lines, then the step.
    const root = repository({
      "infra/plans/3-agent-harness.md": `${frontmatter("active")}## Step 1: Hooks\n\n- [ ] Ship it.\n\nLast retrospective: 2026-11-12 18:00:00Z\n`,
      ".kore/state/journal/local.jsonl": [
        '{"ts":"2026-11-07T10:00:00.000Z","op":"a","kind":"start","command":"local up"}',
        '{"ts":"2026-11-07T10:00:00.000Z","op":"a","kind":"end","outcome":"ok"}',
      ].join("\n"),
    });
    const result = await context(
      root,
      JSON.stringify({ source: "startup", session_id: "s1" }),
    );
    expect(result.code).toBe(0);
    expect(additional(result)).toBe(
      [
        "Session brief from infra/plans/3-agent-harness.md:",
        "Open items: Step 1 (1).",
        "Environment local: last operation `local up` ok on 2026-11-07.",
        'Warning: infra/plans/3-agent-harness.md:11: "2026-11-12 18:00:00Z" is not a retrospective marker; write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ',
      ].join("\n"),
    );
  });
});

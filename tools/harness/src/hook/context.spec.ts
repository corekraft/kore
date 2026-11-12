// The context hook's brief and compaction restore, ported 1:1 from
// .claude/hooks/context.test.mjs onto the shared plan parser.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { describe, expect, it } from "vitest";
import { brief, restore, rules } from "./context.js";
import {
  agents,
  briefDeps,
  deps,
  fourSteps,
  frontmatter,
  plan,
} from "./context-support.js";

describe("context rules", () => {
  it("rules keeps every AGENTS.md rule, joining wrapped lines and keeping enforcement markers", () => {
    expect(rules(agents)).toEqual([
      "- **One owner per resource.** Every resource has exactly one desired-state owner.",
      "- **Deploy what was verified.** Images by digest. _Audited: `image-digest`._",
      "- **Secrets never touch disk.** Encrypt at rest. _Enforced: `secret-path`._",
      "- **Errors are actionable.** Say what's wrong and how to fix it.",
    ]);
  });
});

describe("context restore", () => {
  it("restore says nothing when a session resumes, since its context is intact", async () => {
    const d = deps({
      readPlans: () => Promise.resolve({ "3-agent-harness.md": plan }),
      sessionsSince: () => Promise.resolve(9),
    });
    expect(await restore({ source: "resume" }, d)).toBe("");
  });

  it("restore after compaction states the rules and the active plan's open items", async () => {
    const d = deps({
      readPlans: () => Promise.resolve({ "3-agent-harness.md": plan }),
    });
    const context = await restore({ source: "compact" }, d);
    expect(context).toMatch(/One owner per resource/);
    expect(context).toMatch(/Errors are actionable/);
    expect(context).toMatch(
      /Secrets never touch disk\.\*\* Encrypt at rest\. _Enforced/,
    );
    expect(context).toMatch(/infra\/plans\/3-agent-harness\.md/);
    expect(context).toMatch(/Bound output/);
    expect(context).not.toMatch(/Done here/);
  });

  it("restore without an active plan still states the rules", async () => {
    const context = await restore({ source: "compact" }, deps());
    expect(context).toMatch(/One owner per resource/);
    expect(context).not.toMatch(/Open plan items/);
  });

  it("brief never restates the AGENTS.md rules, which a fresh session already loads", async () => {
    const context = await restore({ source: "startup" }, briefDeps(0));
    expect(context).toMatch(/Session brief/);
    expect(context).not.toMatch(/One owner per resource/);
  });

  it("brief is empty with no open plan and no retrospective due", async () => {
    expect(await restore({ source: "startup" }, deps())).toBe("");
    expect(await restore({ source: "clear" }, deps())).toBe("");
  });

  it("brief and compaction context cover every active plan", async () => {
    const plans = {
      "2-implementation.md": `${frontmatter("active")}## Step 9: Workload\n\n- [ ] Sign images.\n`,
      "3-agent-harness.md": `${frontmatter("done")}## Step 1: Hooks\n\n- [ ] Stale box.\n`,
      "4-knowledge.md": `${frontmatter("active")}## Step 1: ADRs\n\n- [ ] Extract decisions.\n`,
    };
    const d = briefDeps(0, plans as never);
    const fresh = await brief({ source: "startup" }, d);
    expect(fresh).toMatch(/Session brief from infra\/plans\/4-knowledge\.md/);
    expect(fresh).toMatch(
      /Session brief from infra\/plans\/2-implementation\.md/,
    );
    expect(fresh).not.toMatch(/3-agent-harness/);
    const compacted = await restore({ source: "compact" }, d);
    expect(compacted).toMatch(
      /Open plan items in infra\/plans\/4-knowledge\.md:\n.*Extract decisions/,
    );
    expect(compacted).toMatch(
      /Open plan items in infra\/plans\/2-implementation\.md:\n.*Sign images/,
    );
    expect(compacted).not.toMatch(/Stale box/);
  });
});

describe("context brief", () => {
  it("brief names the active plan, its open items per step, and the Next: line", async () => {
    const context = await brief(
      { source: "startup", session_id: "s1" },
      briefDeps(0),
    );
    expect(context).toBe(
      [
        "Session brief from infra/plans/3-agent-harness.md:",
        "Open items: Step 8 (1), Step 9 (1).",
        "Next (Step 9: Operator Load): write the statusline tests, then wire it into settings.",
      ].join("\n"),
    );
  });

  it("brief reminds about a retrospective only once five sessions have passed since the marker", async () => {
    const due = briefDeps(5);
    expect(await brief({ source: "clear", session_id: "s1" }, due)).toMatch(
      /5 sessions since the last retrospective \(2026-11-01\); run \/retro\./,
    );
    expect(due.calls).toEqual([["2026-11-01", "s1"]]);
    expect(await brief({ source: "clear" }, briefDeps(4))).not.toMatch(/retro/);
  });

  it("brief without a marker counts every session as since the last retrospective", async () => {
    const d = briefDeps(5, { "3-agent-harness.md": plan });
    expect(await brief({ source: "startup" }, d)).toMatch(
      /5 sessions without a recorded retrospective; run \/retro\./,
    );
  });

  it("brief lists upcoming step titles, and none after the last step", async () => {
    const withPlan = (markdown: string) =>
      briefDeps(0, { "4-knowledge.md": markdown } as never);
    expect(await brief({ source: "startup" }, withPlan(fourSteps))).toMatch(
      /^Upcoming: Step 3: Third; Step 5: Fifth; Step 6: Sixth\.$/m,
    );
    expect(await brief({ source: "startup" }, withPlan(plan))).not.toMatch(
      /Upcoming/,
    );
  });
});

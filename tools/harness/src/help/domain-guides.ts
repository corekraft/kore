import type { DomainGuide } from "./guide.js";

/** The guide for each domain of the command table: its purpose in one line, and its usual flow in one line. */
export const domainGuides: Record<string, DomainGuide> = {
  harness: {
    purpose:
      "The harness itself: its version, and the one background wait over pull requests, panes and idea state.",
    flow: "Run the wait command in the background with --pr, --session or --idea; when it settles, act on the state it names and start it again.",
  },
  plan: {
    purpose:
      "Reads and edits the plan files under infra/plans: the active plan, its open items and its single Next: line.",
    flow: "Run plan active to list the plans, plan next to set the Next: line, plan tick to tick an open item, and plan clear-next to remove the line.",
    seeAlso: ["plan active"],
  },
  adr: {
    purpose:
      "Creates and supersedes architecture decision records under docs/decisions, and keeps their index.",
    flow: "Run adr new to write the next numbered record and its index entry, and adr supersede when a newer record replaces an older one.",
  },
  guardrail: {
    purpose:
      "Reads, requests changes to and activates the guardrails that block or warn on tool calls, and generates the settings deny list.",
    flow: "Run guardrail status to read each guardrail, guardrail request to ask a person to approve a mode change, and guardrail activate to apply it only after that approval; guardrail replay checks a rule change against recorded calls first.",
  },
  hook: {
    purpose:
      "The commands Claude Code runs on session, prompt and tool events, wired by settings; a usage error here exits 1, so a typo cannot block a tool call.",
    flow: "The hook events in .claude/settings.json call these commands; run one by hand to see the output a session would receive.",
  },
  session: {
    purpose:
      "Starts, waits for, messages and closes the Claude sessions that run in Herdr panes, and reports their tier and prompt size.",
    flow: "Run session spawn with --no-wait, then session wait for its name in the background to collect its RESULT line, and session close once the result is recorded.",
  },
  skill: {
    purpose:
      "Audits the skills under .claude against their description and body budgets.",
    flow: "Run skill audit after editing a skill to see whether its description or its body is over budget.",
  },
  idea: {
    purpose:
      "Records the harness ideas: each one's hypothesis, measurement and safety pattern, mirrored to its GitHub issue.",
    flow: "Run idea new to create one, idea sync to mirror it to its issue, and idea list or idea show to read them back.",
  },
  outcome: {
    purpose:
      "Records an idea's measured outcome on its record and its issue, and closes the issue once the outcome is recorded.",
    flow: "Run outcome record with the result (confirmed, refuted or inconclusive) and its evidence, then outcome close to close the issue.",
  },
  decision: {
    purpose:
      "Routes the questions the panes raise: the advisor decides what it may, and reserved questions go to the owner.",
    flow: "Run decision route to send a question to the advisor or the owner; decision make posts the advisor's decision, decision ask posts a reserved question, and decision digest posts the daily digest.",
  },
  flag: {
    purpose:
      "The feature flags: an audit of each flag's proof, and activation, which turns a flag on only after its outcome is recorded.",
    flow: "Run flag audit to list each flag and whether its proof is recorded, then flag activate for a flag whose live-run outcome is recorded for that environment.",
  },
  ruleset: {
    purpose:
      "Syncs the repository's GitHub rulesets from .github/rulesets and summarizes what a candidate ruleset would block.",
    flow: "Run ruleset sync to apply a ruleset file, and ruleset insights to see what an evaluate-mode candidate would have blocked before it is activated.",
  },
  status: {
    purpose:
      "One read-only report of where the work stands: plan items, ideas by state, open owner questions, recent stages and the tick's heartbeat.",
    flow: "Run the status command whenever you need the picture; it changes nothing.",
  },
  judge: {
    purpose:
      "The judge's gate on a pull request: its precheck, declaration, diff and send-back, and the approve and merge only the judge runs.",
    flow: "Run judge precheck to read a PR's pattern and results, judge declaration to audit its body, and judge send-back to return a failing change to its writer; judge approve or judge merge runs once the precheck passes on the verified head.",
  },
  review: {
    purpose:
      "The principles review of a pull request: running the Reviewer, posting its verdict, and resampling passed reviews of merged PRs.",
    flow: "Run review run to spawn the principles-review Reviewer on a PR head and collect its verdict; review post posts a verdict in the format the precheck reads; review resample re-reviews a sample of merged PRs.",
  },
  pr: {
    purpose:
      "Opens a pull request with its declared safety pattern, reads its checks, and says what its writer must fix for the judge's precheck.",
    flow: "Run pr open to open a PR, pr checks --wait to follow its checks, and pr check to list the failures its writer owns to fix.",
  },
  ledger: {
    purpose:
      "The stage ledger, the record of what happened, read and appended only through these commands.",
    flow: "Run ledger record to append one validated event, ledger list to read events by session, idea, kind or time, and ledger poll-herdr or ledger poll-github to append what the panes and GitHub show.",
  },
  flow: {
    purpose:
      "Reads the ledger into the stage report: each stage's active and waiting time, toil, work in progress and the metrics ideas measure.",
    flow: "Run flow report over a window to see where the time goes; it reads the ledger and writes nothing.",
  },
  queue: {
    purpose:
      "The work queue: approved ideas and pending judge send-backs, and the escalation that relaunches a writer on a stronger model.",
    flow: "Run queue next to list what to work on, oldest first; queue send-backs to count a PR's send-backs and name the writer model; queue escalate to record the escalation at two send-backs.",
  },
  retro: {
    purpose:
      "The retrospective: says when a retro is due, and records the trigger for one.",
    flow: "Run retro due to see whether one is due, and retro record to log the trigger once per reason and window.",
  },
  evaluate: {
    purpose:
      "After a harness idea's measurement window, compares its hypothesis metric before and after and records whether the change was confirmed, refuted or inconclusive.",
    flow: "Run evaluate for an idea once its window has passed; it refuses inside the window and reads the metric from the ledger, never from an agent.",
  },
  orchestrate: {
    purpose:
      "Drives approved ideas to a recorded outcome through the writer, the judge and the send-back loop.",
    flow: "Run orchestrate run for one idea to take it through writer and judge; orchestrate tick advances each queued idea one step per pass behind its flag; orchestrate plan persists a work plan for a tick.",
  },
  approve: {
    purpose:
      "Applies ready-for-agent to a harness idea whose change is reversible and whose metric has history, and leaves any other for a person.",
    flow: "Run approve for an idea to get its verdict; it writes nothing and only reports the verdict while the automatic-approval flag is off.",
  },
};

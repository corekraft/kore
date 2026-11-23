import type { DomainName } from "../cli/index.js";
import type { DomainGuide } from "./guide.js";

/** The guide for each domain of the command table: its purpose in one line, and its usual flow in one line. */
export const domainGuides: Record<DomainName, DomainGuide> = {
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
    flow: "Run guardrail status to read each guardrail, guardrail request to ask a person to approve a mode change, and guardrail activate to apply it only after that approval; guardrail replay checks a rule change against recorded calls first, and guardrail deny keeps the settings deny list in step with the inventory.",
  },
  hook: {
    purpose:
      "The commands the agent host runs on session, prompt and tool events, and the repository checks mise runs; a usage error here exits 1, so a typo cannot block a tool call.",
    flow: "Each host event names its command in .claude/settings.json: SessionStart runs context and record session-start, UserPromptSubmit runs delta, PreToolUse runs guard, and PostToolUse, PostToolUseFailure and Stop run feedback; run one by hand with stdin from /dev/null to see its output.",
    seeAlso: ["guardrail status", "retro due"],
  },
  session: {
    purpose:
      "Starts, waits for, messages and closes the Claude sessions that run as hc terminals, checks the agent terminals, and reports a role's tier.",
    flow: "Run session spawn, then session wait for its name to collect its report, and session close once the report is recorded.",
    seeAlso: ["harness wait"],
  },
  skill: {
    purpose:
      "Audits the skills under skills/ against their description and body budgets.",
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
    flow: "Run outcome record with the result (confirmed, refuted or inconclusive), its evidence and its summary; it publishes the outcome and closes the issue, and outcome close finishes publishing when a run stopped partway.",
  },
  decision: {
    purpose:
      "Routes the questions the panes raise: the advisor decides what it may, and reserved questions go to the owner.",
    flow: "Run decision route to send a question to the advisor or the owner; decision make posts the advisor's decision, decision ask posts a reserved question, and decision digest posts the daily digest. All four are refused while the decision-advisor flag is off.",
    seeAlso: [
      "decision route",
      "decision make",
      "decision ask",
      "decision digest",
    ],
  },
  flag: {
    purpose:
      "The feature flags: an audit of each flag's proof, and activation, which turns a flag on only after its outcome is recorded.",
    flow: "Run flag audit to fail on any flag that is on without a recorded proof, then flag activate for a flag whose verification outcome (a live run, or an owner waiver) is recorded for that environment.",
  },
  ruleset: {
    purpose:
      "Syncs the repository's GitHub rulesets from .github/rulesets and summarizes what a candidate ruleset would block.",
    flow: "Run ruleset sync --dry-run to plan a ruleset file, ruleset sync --confirm to apply it once the operator agrees, and ruleset insights to see what the evaluate-mode candidate would have blocked before it is activated.",
  },
  status: {
    purpose:
      "One read-only report of where the work stands: plan items, ideas by state, open owner questions, recent stages and the tick's heartbeat.",
    flow: "Run harness status whenever you need the picture; it changes nothing.",
    seeAlso: ["ledger list", "decision digest"],
  },
  judge: {
    purpose:
      "The judge's gate on a pull request: its verdict, its diff and its body audit, and the approve, merge and send-back that only the judge pane runs.",
    flow: "Run judge precheck to read a PR's verdict, judge diff to read its change and judge declaration to audit a body on stdin; once the precheck passes, judge approve then judge merge, and judge send-back returns a failing change to its writer.",
  },
  review: {
    purpose:
      "The principles review of a pull request: running the Reviewer and posting a verdict.",
    flow: "Run review run to have a principles-review Reviewer read a PR's head and post its verdict; review post posts findings a Reviewer reported, in the format the precheck reads.",
  },
  pr: {
    purpose:
      "Opens a pull request with its declared safety pattern, reads its checks, and says what its writer must fix for the judge's precheck.",
    flow: "Run pr open to open a PR, pr checks --wait to follow its checks, and pr check to list the failures its writer owns to fix.",
  },
  ledger: {
    purpose:
      "The stage ledger, the record of what happened, read and appended only through these commands.",
    flow: "Run ledger record to append one validated event, ledger list to read events by session, idea, kind or time, and ledger poll-github to append what GitHub shows, and ledger watch to append what the hc terminals report.",
    seeAlso: ["ledger list", "flow report"],
  },
  flow: {
    purpose:
      "Reads the ledger into the stage report: each stage's active and waiting time, toil, work in progress and the metrics ideas measure.",
    flow: "Run flow report over a window to see where the time goes; it reads the ledger and writes nothing.",
  },
  queue: {
    purpose:
      "The work queue: approved ideas and pending judge send-backs, and the escalation that relaunches a writer on a stronger model.",
    flow: "Run queue next to list what to work on, oldest first (the whole ticket frontier behind tick-ticket-queue); queue send-backs to count a PR's send-backs and name the writer model; queue escalate to record the escalation at two send-backs.",
  },
  retro: {
    purpose:
      "The retrospective: says when a retro is due, and records the trigger for one.",
    flow: "Run retro due to see whether one is due, and after the retro runs, retro record to log its trigger and move the Last retrospective marker.",
  },
  evaluate: {
    purpose:
      "After a harness idea's measurement window, compares its hypothesis metric before and after and records whether the change was confirmed, refuted or inconclusive.",
    flow: "Run evaluate for an idea once its window has passed; it refuses inside the window and reads the metric from the ledger, never from an agent.",
  },
  orchestrate: {
    purpose:
      "Drives approved ideas to a recorded outcome through the writer, the judge and the send-back loop.",
    flow: "Run orchestrate run for one idea to take it through writer and judge; orchestrate tick advances each approved idea one step per pass behind the orchestrator-tick flag; orchestrate plan records a work plan for a tick.",
  },
  approve: {
    purpose:
      "Applies ready-for-agent to a harness idea whose change is reversible and whose metric has history, and leaves any other for a person.",
    flow: "Run approve --idea for an idea to get its verdict; with the automatic-approval flag off it writes nothing and only reports the verdict.",
  },
};

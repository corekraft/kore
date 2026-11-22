import { join, resolve } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  PLANS_DIRECTORY,
  TickPlanStore,
  checkPlan,
  pieceNameProblem,
  tickFlagOn,
  type WorkPiece,
} from "../orchestrator/index.js";
import {
  mainRoot,
  type CliDeps,
  type Command,
  type CommandContext,
  type CommandHelp,
} from "../runtime/index.js";

const FAILED = 1;

const planHelp: CommandHelp = {
  purpose:
    "Records one work plan for an idea: reads the plan as JSON on stdin, checks it whole, persists it once in the main checkout and appends one tick.plan event. It refuses a plan the tick cannot run, and records nothing then.",
  when: "When the judgment pane has printed a work list for an approved idea, and the tick should start its pieces in order.",
  whenNot:
    "When no checked work list is in hand, or the flag is off: it records nothing. A rerun of the same plan records nothing twice; a different plan for an idea already recorded is refused.",
  flags: {
    idea: "The idea number, such as 0007. Required.",
    issue: "The idea's GitHub issue number, digits only. Required.",
  },
  examples: [
    {
      command: "harness orchestrate plan --idea 0007 --issue 1797 < plan.json",
      shows:
        "the piece count of the checked plan, and that it was recorded or was already recorded",
    },
    {
      command:
        "harness orchestrate plan --idea 0007 --issue 1797 --json < plan.json",
      shows:
        "the idea, the piece count, and whether the plan and its event were written or were already there, as one object",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "the plan was recorded, or the same plan was already recorded",
    },
    {
      code: 1,
      meaning:
        "refused, nothing recorded: the flag is off, --idea or --issue is missing or invalid, stdin is not valid JSON or not a checkable work plan, a piece's pane name would be refused, or a different plan is already recorded for the idea; or the tick.plan event was rejected, after the plan was kept, so a rerun records the event",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "writes .kore/state/tick-plans/<idea>.json in the main checkout once, and appends one tick.plan ledger event carrying the piece count; a rerun of the same plan writes and records nothing twice",
  },
  seeAlso: ["orchestrate tick", "orchestrate run"],
};

/**
 * The tick's owning script for a work plan (ADR 0121): it checks the plan on stdin whole, persists it
 * once per idea in the main checkout's state, and records one tick.plan event. A rerun changes nothing
 * twice. It refuses whatever the tick cannot run, so nothing is written for a bad plan.
 */
export const planCommand: Command = {
  summary:
    "behind the local orchestrator-tick flag (off): reads one work plan as JSON on stdin, an object with a work list as the judgment pane prints it, checks it whole with the same checker the judgment flow uses, and refuses it with the item and field named when it does not check, when a piece's pane name would be refused by session spawn, or when another plan for the idea is already persisted; writes the checked plan to .kore/state/tick-plans/<idea>.json in the main checkout once, and appends one tick.plan ledger event carrying the piece count, so a rerun of the same plan writes and records nothing twice; requires --idea (for example 0007) and --issue (the idea's issue number); with the flag off it records nothing and exits 1; --json prints the idea, the piece count, and whether the plan was written or already there and whether the event was recorded or already there",
  options: { idea: "string", issue: "string" },
  help: planHelp,
  run: runPlan,
};

type Work = { ok: true; work: WorkPiece[] } | { ok: false; error: string };

type Persisted =
  | { ok: true; plan: "written" | "same"; event: "recorded" | "present" }
  | { ok: false; error: string };

/** The work list on stdin, checked whole and given a pane name per piece the tick can spawn. */
function readWork(text: string, idea: string): Work {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error:
        "The plan on stdin is not valid JSON; give it one JSON object with a work list. Nothing was recorded.",
    };
  }
  const checked = checkPlan(raw);
  if (!checked.ok) {
    return { ok: false, error: checked.error };
  }
  if (checked.plan.kind !== "work") {
    return {
      ok: false,
      error:
        "The plan on stdin must be a work plan: give it one object with a work list. Nothing was recorded.",
    };
  }
  const problem = pieceNameProblem(idea, checked.plan.work);
  return problem === undefined
    ? { ok: true, work: checked.plan.work }
    : { ok: false, error: problem };
}

/** The plan written once for the idea, then the tick.plan event recorded once for it. */
async function persist(
  deps: CliDeps,
  main: string,
  idea: string,
  issue: number,
  work: WorkPiece[],
): Promise<Persisted> {
  const store = new TickPlanStore(deps.fs, join(main, PLANS_DIRECTORY));
  const plan = await store.write({ idea, issue, work });
  if (plan.status === "refused") {
    return { ok: false, error: plan.error };
  }
  const ledger = new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    resolve(main, DEFAULT_LEDGER),
  );
  const listed = await ledger.list({ kind: "tick.plan", idea });
  if (listed.events.length > 0) {
    return { ok: true, plan: plan.status, event: "present" };
  }
  const written = await ledger.record({
    source: "claude",
    kind: "tick.plan",
    occurredAt: deps.clock.now().toISOString(),
    idea,
    number: work.length,
  });
  if (!written.ok) {
    return {
      ok: false,
      error: `The tick.plan event was rejected: ${written.message}. The plan is persisted; fix the ledger, then rerun orchestrate plan.`,
    };
  }
  return { ok: true, plan: plan.status, event: "recorded" };
}

async function runPlan(context: CommandContext): Promise<number> {
  const { deps, options, json } = context;
  const refuse = (message: string): number => {
    deps.stderr(`${message}\n`);
    return FAILED;
  };
  const root = await deps.root();
  if (!(await tickFlagOn(deps.fs, root))) {
    return refuse(
      "The orchestrator-tick flag is off in the local overlay, so no work plan was recorded.",
    );
  }
  const idea = options["idea"];
  const issue = options["issue"];
  if (
    typeof idea !== "string" ||
    typeof issue !== "string" ||
    !/^\d+$/.test(issue)
  ) {
    return refuse(
      "Give the idea with --idea, for example --idea 0007, and its issue with --issue.",
    );
  }
  const input = readWork(await deps.stdin(), idea);
  if (!input.ok) {
    return refuse(input.error);
  }
  const main = (await mainRoot(deps)) ?? root;
  const persisted = await persist(deps, main, idea, Number(issue), input.work);
  if (!persisted.ok) {
    return refuse(persisted.error);
  }
  report(deps, json, idea, input.work.length, persisted);
  return 0;
}

function report(
  deps: CliDeps,
  json: boolean,
  idea: string,
  pieces: number,
  persisted: Extract<Persisted, { ok: true }>,
): void {
  if (json) {
    deps.stdout(
      `${JSON.stringify({ idea, pieces, plan: persisted.plan, event: persisted.event })}\n`,
    );
    return;
  }
  deps.stdout(
    persisted.plan === "same" && persisted.event === "present"
      ? `The work plan for idea ${idea} is already recorded: ${pieces} pieces, nothing written.\n`
      : `Recorded the work plan for idea ${idea}: ${pieces} pieces.\n`,
  );
}

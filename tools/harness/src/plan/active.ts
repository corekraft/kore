import { join } from "node:path";
import type { CliDeps, Command } from "../runtime/index.js";
import {
  activePlans,
  nextStep,
  openCounts,
  upcomingSteps,
  type NextStep,
  type StepCount,
} from "./parser.js";

const PLANS_DIR = "infra/plans";

export interface ActivePlan {
  file: string;
  name: string;
  default: boolean;
  open: StepCount[];
  next: NextStep | null;
  upcoming: string[];
}

async function readPlans(deps: CliDeps): Promise<Record<string, string>> {
  const root = await deps.root();
  let names: string[];
  try {
    names = (await deps.fs.readdir(join(root, PLANS_DIR))).filter((n) =>
      n.endsWith(".md"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const plans: Record<string, string> = {};
  for (const name of names) {
    plans[name] = await deps.fs.readFile(join(root, PLANS_DIR, name));
  }
  return plans;
}

function describe(plan: ActivePlan): string {
  const open = plan.open.map((o) => `${o.step} (${o.count})`).join(", ");
  const lines = [`${plan.file}${plan.default ? " (default)" : ""}`];
  lines.push(`  Open items: ${open || "none"}`);
  if (plan.next) {
    lines.push(`  Next (${plan.next.step}): ${plan.next.text}`);
  }
  if (plan.upcoming.length > 0) {
    lines.push(`  Upcoming: ${plan.upcoming.join("; ")}`);
  }
  return lines.join("\n");
}

export const planActive: Command = {
  summary: "list the active plans, flagging the default (highest-numbered)",
  async run({ json, deps }) {
    const plans = await readPlans(deps);
    const names = activePlans(plans);
    const listed: ActivePlan[] = names.map((name, index) => {
      const markdown = plans[name] ?? "";
      return {
        file: `${PLANS_DIR}/${name}`,
        name,
        default: index === 0,
        open: openCounts(markdown),
        next: nextStep(markdown),
        upcoming: upcomingSteps(markdown),
      };
    });
    if (json) {
      deps.stdout(
        `${JSON.stringify({ default: names[0] ?? null, plans: listed })}\n`,
      );
    } else if (listed.length === 0) {
      deps.stdout(
        `No active plan: no file in ${PLANS_DIR} has "status: active" in its frontmatter.\n`,
      );
    } else {
      deps.stdout(`${listed.map(describe).join("\n")}\n`);
    }
    return 0;
  },
};

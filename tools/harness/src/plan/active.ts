import type { CliDeps, Command } from "../runtime/index.js";
import {
  activePlans,
  nextStep,
  openCounts,
  upcomingSteps,
  type NextStep,
  type StepCount,
} from "./parser.js";
import { PLANS_DIR, readPlans } from "./store.js";

export interface ActivePlan {
  file: string;
  name: string;
  default: boolean;
  open: StepCount[];
  next: NextStep | null;
  upcoming: string[];
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

/** The active plans, highest-numbered first, each with its open items. */
export async function readActivePlans(deps: CliDeps): Promise<ActivePlan[]> {
  const plans = await readPlans(deps);
  return activePlans(plans).map((name, index) => {
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
}

export const planActive: Command = {
  summary: "list the active plans, flagging the default (highest-numbered)",
  async run({ json, deps }) {
    const listed = await readActivePlans(deps);
    const names = listed.map((plan) => plan.name);
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

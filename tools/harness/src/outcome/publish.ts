import type { Runner } from "../runtime/index.js";
import { IdeaError } from "../idea/index.js";
import { labelFor, type Result } from "./model.js";

export interface Published {
  commented: boolean;
  labelled: boolean;
  closed: boolean;
}

interface Target {
  number: string;
  repo: string;
}

interface View {
  open: boolean;
  labels: string[];
  comments: string[];
}

const FIX = "Check `gh auth status`, then rerun `harness outcome close`.";

function names(value: unknown, key: string): string[] {
  return Array.isArray(value)
    ? value.flatMap((v: unknown) => {
        const found = (v as Record<string, unknown> | null)?.[key];
        return typeof found === "string" ? [found] : [];
      })
    : [];
}

function parseView(stdout: string, target: Target): View {
  try {
    const view = JSON.parse(stdout) as Record<string, unknown>;
    return {
      open: view["state"] !== "CLOSED",
      labels: names(view["labels"], "name"),
      comments: names(view["comments"], "body"),
    };
  } catch {
    throw new IdeaError(
      `gh returned unreadable output for issue ${target.number}; ${FIX}`,
    );
  }
}

/**
 * Brings an idea's issue in line with its recorded outcome: one comment, exactly one
 * outcome label, closed. Each step is skipped when already done, so a rerun after a
 * partial failure finishes the rest and a finished issue gets no gh write at all.
 */
export async function publishOutcome(
  runner: Runner,
  root: string,
  target: Target,
  outcome: { result: Result; marker: string; comment: string },
): Promise<Published> {
  const gh = async (args: string[], input?: string) => {
    const done = await runner.run("gh", args, {
      cwd: root,
      ...(input === undefined ? {} : { input }),
    });
    if (done.code !== 0) {
      throw new IdeaError(
        `gh ${args.slice(0, 2).join(" ")} failed for issue ${target.number}: ${done.stderr.trim()}. ${FIX}`,
      );
    }
    return done.stdout;
  };
  const at = ["--repo", target.repo];
  const view = parseView(
    await gh([
      "issue",
      "view",
      target.number,
      ...at,
      "--json",
      "state,labels,comments",
    ]),
    target,
  );
  const published: Published = {
    commented: false,
    labelled: false,
    closed: false,
  };
  if (!view.comments.some((body) => body.includes(outcome.marker))) {
    await gh(
      ["issue", "comment", target.number, ...at, "--body-file", "-"],
      outcome.comment,
    );
    published.commented = true;
  }
  const wanted = labelFor(outcome.result);
  const stale = view.labels.filter(
    (l) => l.startsWith("outcome:") && l !== wanted,
  );
  const add = view.labels.includes(wanted) ? [] : [wanted];
  if (add.length > 0 || stale.length > 0) {
    await gh([
      "issue",
      "edit",
      target.number,
      ...at,
      ...add.flatMap((l) => ["--add-label", l]),
      ...stale.flatMap((l) => ["--remove-label", l]),
    ]);
    published.labelled = true;
  }
  if (view.open) {
    await gh(["issue", "close", target.number, ...at]);
    published.closed = true;
  }
  return published;
}

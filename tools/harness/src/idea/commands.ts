import type { Command, CommandContext } from "../runtime/index.js";
import { IdeaError, scalar, type IdeaRecord, type NewIdea } from "./record.js";
import { IdeaRepository } from "./repository.js";

const FAILED = 1;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function repository({ deps }: CommandContext): Promise<IdeaRepository> {
  const root = await deps.root().catch((cause: unknown) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  return new IdeaRepository(deps.fs, deps.clock, root);
}

/** Runs an action, turning an IdeaError into an actionable message and a non-zero exit. */
async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<void>,
): Promise<number> {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!(error instanceof IdeaError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}\n` : "";
    deps.stderr(`${prefix}${error.message}\n`);
    return FAILED;
  }
}

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function describe(record: IdeaRecord): string {
  const lines = [
    `Idea ${record.number}: ${record.title}`,
    `Date: ${record.date}`,
    `Summary: ${record.summary}`,
    `Hypothesis: ${record.hypothesis}`,
    `Expected outcome: ${record.expectedOutcome}`,
    `Measurement: ${record.measurement}`,
    `Safety pattern: ${record.safetyPattern}`,
  ];
  for (const [label, value] of [
    ["Outcome", record.outcome],
    ["Issue", record.issue],
    ["Parent", record.parent],
  ] as const) {
    if (value !== undefined) {
      lines.push(`${label}: ${value}`);
    }
  }
  lines.push(`File: ${record.path}`);
  return `${lines.join("\n")}\n`;
}

function parseNewIdea(options: CommandContext["options"]): {
  slug: string;
  idea: NewIdea;
} {
  const title = scalar("title", text(options, "title"));
  const slug = text(options, "slug") ?? slugOf(title);
  if (!SLUG.test(slug)) {
    throw new IdeaError(
      `Slug "${slug}" is invalid; use lowercase letters, digits and single hyphens, e.g. cache-probe-results.`,
    );
  }
  const idea: NewIdea = {
    title,
    summary: scalar("summary", text(options, "summary") ?? title),
    hypothesis: scalar("hypothesis", text(options, "hypothesis")),
    expectedOutcome: scalar(
      "expected-outcome",
      text(options, "expected-outcome"),
    ),
    measurement: scalar("measurement", text(options, "measurement")),
    safetyPattern: scalar("safety-pattern", text(options, "safety-pattern")),
  };
  for (const key of ["issue", "parent"] as const) {
    const value = text(options, key);
    if (value !== undefined) {
      idea[key] = scalar(key, value);
    }
  }
  return { slug, idea };
}

const create: Command = {
  summary:
    "create the next numbered idea record and index it (--title --hypothesis --expected-outcome --measurement --safety-pattern [--slug] [--summary] [--issue] [--parent])",
  options: {
    title: "string",
    slug: "string",
    summary: "string",
    hypothesis: "string",
    "expected-outcome": "string",
    measurement: "string",
    "safety-pattern": "string",
    issue: "string",
    parent: "string",
  },
  run(context) {
    return guarded(context, async () => {
      const { slug, idea } = parseNewIdea(context.options);
      const { created, record } = await (
        await repository(context)
      ).create(slug, idea);
      context.deps.stdout(
        context.json
          ? `${JSON.stringify({ created, ...record })}\n`
          : `${created ? "Created" : "Already exists:"} ${record.path}\n`,
      );
    });
  },
};

const show: Command = {
  summary: "print one idea record (--idea <number or slug>)",
  options: { idea: "string" },
  run(context) {
    return guarded(context, async () => {
      const ref = text(context.options, "idea");
      if (ref === undefined || ref.trim() === "") {
        throw new IdeaError(
          "Missing --idea; run `harness idea show --idea <number or slug>`, or `harness idea list` to see the ideas.",
        );
      }
      const record = await (await repository(context)).get(ref.trim());
      context.deps.stdout(
        context.json ? `${JSON.stringify(record)}\n` : describe(record),
      );
    });
  },
};

const list: Command = {
  summary: "list every idea record in number order",
  run(context) {
    return guarded(context, async () => {
      const records = await (await repository(context)).list();
      context.deps.stdout(
        context.json
          ? `${JSON.stringify(records)}\n`
          : records
              .map((r) => `${r.number} ${r.outcome ?? "open"} ${r.title}\n`)
              .join(""),
      );
    });
  },
};

export const ideaCommands: Record<string, Command> = {
  new: create,
  list,
  show,
};

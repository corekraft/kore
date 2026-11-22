import type { CommandHelp } from "../runtime/index.js";

/** Help for `idea new`: what it records, every flag, the two shapes of idea it makes, and its exits. */
export const createHelp: CommandHelp = {
  purpose:
    "Creates the next numbered idea record under docs/ideas from its title, hypothesis, expected outcome, measurement and safety pattern, and adds its entry to the Ideas section of docs/index.md. With --kind harness it also records the flow report metric the idea expects to move; with --tier-change it records an edit to an agent definition's model or effort.",
  when: "When a change is worth tracking before anyone works on it: its hypothesis, how it is measured and the safety pattern it runs under. Give --kind harness with the metric, direction and window when the flow report should judge it.",
  whenNot:
    "When the idea is already recorded: a slug that exists returns the existing record and creates no file, so read it with idea show. To mirror an idea to GitHub, use idea sync.",
  flags: {
    title:
      "The idea's title, one line. It becomes the record's heading and, unless --slug is given, the file name; it must not start with [ { | > & * ! or -.",
    slug: "The file-name slug: lowercase letters, digits and single hyphens. Without it, the title is slugified and cut to 60 characters.",
    summary:
      "One line for the index entry and the issue body. Without it, the title is used.",
    hypothesis: "What the change is expected to do, as one plain line.",
    "expected-outcome":
      "The result that would show the hypothesis true, as one plain line.",
    measurement: "How that result is measured, as one plain line.",
    "safety-pattern":
      "One of no-behaviour-change, feature-flagged, dark-launched, branch-by-abstraction or expand-contract.",
    issue:
      "The GitHub issue the idea is tracked on, as a number or a link; recorded as given.",
    parent: "The parent the idea belongs under, recorded as given.",
    kind: "harness makes a harness idea with a flow report hypothesis; leave it out for an ordinary idea.",
    metric:
      "The flow report metric the hypothesis is about, such as metrics.tokensPerIdea. It must be one the flow report names; required with --kind harness.",
    direction:
      "up or down: the way the metric is expected to move; required with --kind harness.",
    window:
      "The number of days the metric is watched, such as 14d; required with --kind harness.",
    "tier-change":
      "model, effort or model,effort: the agent-definition fields a tier idea edits. It needs --kind harness, --metric metrics.tokensPerIdea and --direction down.",
    "guard-metric":
      "The metric a tier change must not worsen: rework.sendBacksPerIdea. Required with --tier-change.",
  },
  examples: [
    {
      command:
        'harness idea new --title "Cache the probe results" --hypothesis "Caching the probe results removes repeated probes" --expected-outcome "Each tick probes once per host" --measurement "Count probes per tick before and after" --safety-pattern no-behaviour-change',
      shows:
        "the next numbered record created under docs/ideas, printed as Created with its path",
    },
    {
      command:
        'harness idea new --title "Cache the probe results" --hypothesis "Caching the probe results removes repeated probes" --expected-outcome "Probes per tick fall" --measurement "The flow report metric over 14 days" --safety-pattern no-behaviour-change --kind harness --metric metrics.tokensPerIdea --direction down --window 14d',
      shows:
        "a harness idea whose record also holds the metric, direction and window the flow report judges it by",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the idea is created, or its slug already exists and its record is printed as Already exists",
    },
    {
      code: 1,
      meaning:
        "a required flag is missing or blank, a value is invalid (the slug, the safety pattern, the metric, direction, window or tier change), or docs/index.md is missing; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "creates docs/ideas/NNNN-<slug>.md with the next number and adds its entry to the Ideas section of docs/index.md; an existing slug creates no file and only adds a missing index entry",
  },
  seeAlso: ["idea show", "idea sync", "flow report"],
};

/** Help for `idea list`: one line per idea, and what to run instead to read one. */
export const listHelp: CommandHelp = {
  purpose:
    "Lists every idea record under docs/ideas in number order, one line each: its number, its outcome or open, and its title.",
  when: "When you need an idea's number or slug to pass to idea show or idea sync, or which ideas already have an outcome.",
  whenNot:
    "When you need one idea's full record: use idea show. To see what is queued for work, use queue next.",
  flags: {},
  examples: [
    {
      command: "harness idea list",
      shows:
        "one line per idea, such as 0007 open with its title; an idea with an outcome shows that outcome in place of open",
    },
    {
      command: "harness idea list --json",
      shows:
        "one JSON array of every record, each with the fields idea show prints",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "every idea is listed; with no idea records, nothing is printed",
    },
    {
      code: 1,
      meaning:
        "an idea file is malformed: no frontmatter, a missing field, or a name that is not NNNN-slug.md; stderr names the file and the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "read-only",
    detail: "reads each file under docs/ideas and writes nothing",
  },
  seeAlso: ["idea show", "idea new", "queue next"],
};

/** Help for `idea show`: the labelled record of one idea, and its JSON form. */
export const showHelp: CommandHelp = {
  purpose:
    "Prints one idea record: its number, date, summary, hypothesis, expected outcome, measurement and safety pattern; then its outcome, issue and parent when set, its harness hypothesis when it has one, and its file path.",
  when: "When you need the full record of one idea, such as before idea sync or before reading the metric it is judged by.",
  whenNot:
    "When you need every idea at once: use idea list, which prints one line each.",
  flags: {
    idea: "The idea's number, such as 7 or 0007, its slug, or its file stem such as 0007-cache-the-probe-results.",
  },
  examples: [
    {
      command: "harness idea show --idea 7",
      shows: "idea 0007's record as labelled lines, ending with its File path",
    },
    {
      command: "harness idea show --idea 7 --json",
      shows: "the same record as one JSON object",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "the record is printed",
    },
    {
      code: 1,
      meaning:
        "no --idea is given, no idea matches the reference, or the record is malformed; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "read-only",
    detail: "reads one file under docs/ideas and writes nothing",
  },
  seeAlso: ["idea list", "idea sync"],
};

/** Help for `idea sync`: the issue it creates or edits, and the label and link it records. */
export const syncHelp: CommandHelp = {
  purpose:
    "Mirrors one idea to its GitHub issue. With no issue recorded it creates one from the idea's title and a body rendered from its markdown, and records the new issue's link in the idea's issue: line. With one recorded, it reads the issue and edits its title and body only when they differ. When the recorded issue no longer exists on GitHub, a new issue is created and its link replaces the recorded one.",
  when: "When an idea is ready to be tracked on GitHub, or its markdown has changed and its issue should follow it.",
  whenNot:
    "When you want to change the issue by hand: its body is generated from the idea's file, so edits made on GitHub are overwritten by the next sync. To read the idea, use idea show.",
  flags: {
    idea: "The idea's number, slug or file stem, as for idea show.",
  },
  examples: [
    {
      command: "harness idea sync --idea 7",
      shows:
        "the issue's action, created, updated or unchanged, with its link, such as Issue created: followed by the URL",
    },
    {
      command: "harness idea sync --idea 7 --json",
      shows: "one object with the idea's number, the action and the issue link",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the issue is created, updated, or already in line with the idea",
    },
    {
      code: 1,
      meaning:
        "no --idea is given, no idea matches, the recorded issue is not a number or a link, gh cannot read, edit or create the issue, or the new issue's link cannot be recorded; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "calls gh to create the issue, or to edit its title and body when they differ, and writes a new issue's link to the idea's issue: line, replacing a recorded link when the old issue no longer exists. With the local tick-ticket-queue flag on, a harness idea's issue also gets the harness label when it is created or edited. No label is removed and assignees are never changed.",
  },
  seeAlso: ["idea show", "idea new", "outcome record"],
};

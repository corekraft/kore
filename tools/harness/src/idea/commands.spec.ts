import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../runtime/index.js";
import { ideaCommands } from "./commands.js";
import {
  asRepository,
  fakeDeps,
  fakeRepository,
  recordFixture,
  type FakeDeps,
  type FakeRepository,
} from "./idea-support.js";
import { IdeaError, scalar } from "./record.js";
import { IdeaRepository } from "./repository.js";
import { syncIssue } from "./sync.js";

// The repository, the sync and the field validator are other units: mocked.
// IdeaError stays real, so each command's error channel is the real one.
vi.mock("./repository.js");
vi.mock("./sync.js");
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  scalar: vi.fn(),
}));

const PATH = "docs/ideas/0001-cache-the-probe-results.md";
const URL = "https://github.com/corekraft/kore/issues/300";

const required = (name: string): Command => {
  const command = ideaCommands[name];
  if (command === undefined) {
    throw new Error(`no idea command ${name}`);
  }
  return command;
};
const create = required("new");
const list = required("list");
const show = required("show");
const sync = required("sync");

const context = (
  deps: FakeDeps,
  options: Record<string, string | boolean> = {},
  json = false,
): CommandContext => ({ json, options, deps });

let deps: FakeDeps;
let repo: FakeRepository;

beforeEach(() => {
  deps = fakeDeps();
  repo = fakeRepository();
  vi.mocked(IdeaRepository).mockImplementation(function () {
    return asRepository(repo);
  });
  vi.mocked(scalar).mockImplementation((flag, value) => {
    if (value === undefined || value.trim() === "") {
      throw new IdeaError(`Missing --${flag}; pass a non-empty value.`);
    }
    return value;
  });
});

const FIELDS = {
  title: "Cache the probe results!",
  hypothesis: "Caching probes cuts up time.",
  "expected-outcome": "Up time drops by 20 percent.",
  measurement: "Compare kore local up duration in the ledger.",
  "safety-pattern": "feature-flagged",
};

describe("harness idea new", () => {
  it("derives the slug from the title and hands the idea to the repository", async () => {
    repo.create.mockResolvedValue({ created: true, record: recordFixture() });
    expect(await create.run(context(deps, FIELDS))).toBe(0);
    expect(vi.mocked(IdeaRepository).mock.calls).toEqual([
      [deps.fs, deps.clock, "/repo"],
    ]);
    expect(repo.create.mock.calls).toEqual([
      [
        "cache-the-probe-results",
        {
          title: "Cache the probe results!",
          summary: "Cache the probe results!",
          hypothesis: "Caching probes cuts up time.",
          expectedOutcome: "Up time drops by 20 percent.",
          measurement: "Compare kore local up duration in the ledger.",
          safetyPattern: "feature-flagged",
        },
      ],
    ]);
  });

  it("validates each field through scalar, in the order the flags are read", async () => {
    repo.create.mockResolvedValue({ created: true, record: recordFixture() });
    await create.run(
      context(deps, { ...FIELDS, issue: "185", parent: "0001" }),
    );
    expect(vi.mocked(scalar).mock.calls).toEqual([
      ["title", "Cache the probe results!"],
      ["summary", "Cache the probe results!"],
      ["hypothesis", "Caching probes cuts up time."],
      ["expected-outcome", "Up time drops by 20 percent."],
      ["measurement", "Compare kore local up duration in the ledger."],
      ["safety-pattern", "feature-flagged"],
      ["issue", "185"],
      ["parent", "0001"],
    ]);
  });

  it("uses an explicit slug and an explicit summary when given", async () => {
    repo.create.mockResolvedValue({ created: true, record: recordFixture() });
    await create.run(
      context(deps, { ...FIELDS, slug: "probe", summary: "Short" }),
    );
    expect(repo.create.mock.calls[0]?.[0]).toBe("probe");
    expect(repo.create.mock.calls[0]?.[1]).toMatchObject({ summary: "Short" });
  });
});

describe("harness idea new refusals", () => {
  it("refuses an invalid slug before touching the repository", async () => {
    expect(
      await create.run(context(deps, { ...FIELDS, slug: "Bad Slug" })),
    ).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      [
        'Slug "Bad Slug" is invalid; use lowercase letters, digits and single hyphens, e.g. cache-probe-results.\n',
      ],
    ]);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("reports a refused field on stderr, exits 1 and writes nothing", async () => {
    const { title: _dropped, ...withoutTitle } = FIELDS;
    expect(await create.run(context(deps, withoutTitle))).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      ["Missing --title; pass a non-empty value.\n"],
    ]);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("prints the path it created, or the existing one, as text", async () => {
    repo.create.mockResolvedValueOnce({
      created: true,
      record: recordFixture(),
    });
    await create.run(context(deps, FIELDS));
    repo.create.mockResolvedValueOnce({
      created: false,
      record: recordFixture(),
    });
    await create.run(context(deps, FIELDS));
    expect(deps.stdout.mock.calls).toEqual([
      [`Created ${PATH}\n`],
      [`Already exists: ${PATH}\n`],
    ]);
  });

  it("prints the record as one JSON object, with created, under --json", async () => {
    repo.create.mockResolvedValue({ created: true, record: recordFixture() });
    await create.run(context(deps, FIELDS, true));
    expect(deps.stdout.mock.calls).toEqual([
      [JSON.stringify({ created: true, ...recordFixture() }) + "\n"],
    ]);
  });

  it("lets a crash that is not an IdeaError propagate", async () => {
    repo.create.mockRejectedValue(new Error("disk on fire"));
    await expect(create.run(context(deps, FIELDS))).rejects.toThrow(
      "disk on fire",
    );
  });
});

describe("harness idea show", () => {
  it("prints the record's fields as text, with the optional links last", async () => {
    repo.get.mockResolvedValue(
      recordFixture({ outcome: "refuted", issue: "185", parent: "0002" }),
    );
    expect(await show.run(context(deps, { idea: " 1 " }))).toBe(0);
    expect(repo.get.mock.calls).toEqual([["1"]]);
    expect(deps.stdout.mock.calls).toEqual([
      [
        [
          "Idea 0001: Cache the probe results",
          "Date: 2026-03-04",
          "Summary: Cache the probe results",
          "Hypothesis: Caching probes cuts up time.",
          "Expected outcome: Up time drops by 20 percent.",
          "Measurement: Compare kore local up duration in the ledger.",
          "Safety pattern: feature-flagged",
          "Outcome: refuted",
          "Issue: 185",
          "Parent: 0002",
          `File: ${PATH}`,
        ].join("\n") + "\n",
      ],
    ]);
  });

  it("prints the record as JSON under --json", async () => {
    repo.get.mockResolvedValue(recordFixture());
    await show.run(context(deps, { idea: "1" }, true));
    expect(deps.stdout.mock.calls).toEqual([
      [JSON.stringify(recordFixture()) + "\n"],
    ]);
  });

  it("without --idea, names the flag and the list command", async () => {
    expect(await show.run(context(deps, {}))).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      [
        "Missing --idea; run `harness idea show --idea <number or slug>`, or `harness idea list` to see the ideas.\n",
      ],
    ]);
    expect(repo.get).not.toHaveBeenCalled();
  });

  it("reports an unknown reference as JSON on stderr under --json", async () => {
    repo.get.mockRejectedValue(new IdeaError('No idea matches "9".'));
    expect(await show.run(context(deps, { idea: "9" }, true))).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      [
        `${JSON.stringify({ error: 'No idea matches "9".' })}\n` +
          'No idea matches "9".\n',
      ],
    ]);
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("reports a missing repository root as an actionable error and exits 1", async () => {
    deps.root.mockRejectedValue(new Error("Cannot find the repo root."));
    expect(await show.run(context(deps, { idea: "1" }))).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([["Cannot find the repo root.\n"]]);
  });
});

describe("harness idea list", () => {
  it("prints every idea as number, outcome or open, and title", async () => {
    repo.list.mockResolvedValue([
      recordFixture(),
      recordFixture({ number: "0002", title: "Done", outcome: "confirmed" }),
    ]);
    expect(await list.run(context(deps))).toBe(0);
    expect(deps.stdout.mock.calls).toEqual([
      ["0001 open Cache the probe results\n0002 confirmed Done\n"],
    ]);
  });

  it("prints the list as JSON under --json", async () => {
    repo.list.mockResolvedValue([recordFixture()]);
    await list.run(context(deps, {}, true));
    expect(deps.stdout.mock.calls).toEqual([
      [`${JSON.stringify([recordFixture()])}\n`],
    ]);
  });

  it("prints nothing and succeeds when there are no ideas", async () => {
    repo.list.mockResolvedValue([]);
    expect(await list.run(context(deps))).toBe(0);
    expect(deps.stdout.mock.calls).toEqual([[""]]);
  });
});

describe("harness idea sync", () => {
  it("mirrors the idea through syncIssue and prints the action and the issue", async () => {
    const record = recordFixture();
    repo.get.mockResolvedValue(record);
    repo.source.mockResolvedValue("SOURCE");
    vi.mocked(syncIssue).mockResolvedValue({ action: "created", issue: URL });
    expect(await sync.run(context(deps, { idea: "1" }))).toBe(0);
    const [runner, root, synced, text] =
      vi.mocked(syncIssue).mock.calls[0] ?? [];
    expect([runner, root, synced, text]).toEqual([
      deps.runner,
      "/repo",
      record,
      "SOURCE",
    ]);
    expect(deps.stdout.mock.calls).toEqual([[`Issue created: ${URL}\n`]]);
  });

  it("records the issue link through the repository when syncIssue reports it", async () => {
    const record = recordFixture();
    repo.get.mockResolvedValue(record);
    vi.mocked(syncIssue).mockImplementation(
      async (_r, _root, _rec, _t, link) => {
        await link(URL);
        return { action: "created", issue: URL };
      },
    );
    await sync.run(context(deps, { idea: "1" }));
    expect(repo.recordIssue.mock.calls).toEqual([[record, URL]]);
  });

  it("prints the idea number, action and issue as JSON under --json", async () => {
    repo.get.mockResolvedValue(recordFixture());
    vi.mocked(syncIssue).mockResolvedValue({ action: "unchanged", issue: URL });
    await sync.run(context(deps, { idea: "1" }, true));
    expect(deps.stdout.mock.calls).toEqual([
      [
        `${JSON.stringify({ idea: "0001", action: "unchanged", issue: URL })}\n`,
      ],
    ]);
  });

  it("without --idea, names the flag and does not call gh", async () => {
    expect(await sync.run(context(deps, {}))).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      [
        "Missing --idea; run `harness idea sync --idea <number or slug>`, or `harness idea list` to see the ideas.\n",
      ],
    ]);
    expect(syncIssue).not.toHaveBeenCalled();
  });
});

describe("the idea command table", () => {
  it("exposes exactly the four idea commands", () => {
    expect(Object.keys(ideaCommands).sort()).toEqual([
      "list",
      "new",
      "show",
      "sync",
    ]);
  });
});

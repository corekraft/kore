import { beforeEach, describe, expect, it, vi } from "vitest";
import { ideaCommands } from "./commands.js";
import {
  FIELDS,
  PATH,
  context,
  create,
  prepareCommands,
} from "./commands-support.js";
import type { FakeDeps, FakeRepository } from "./idea-support.js";
import { recordFixture } from "./idea-support.js";
import { IdeaRepository } from "./repository.js";
import { scalar } from "./record.js";

vi.mock("./repository.js");
vi.mock("./sync.js");
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  scalar: vi.fn(),
}));

let deps: FakeDeps;
let repo: FakeRepository;

beforeEach(() => {
  ({ deps, repo } = prepareCommands());
});

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

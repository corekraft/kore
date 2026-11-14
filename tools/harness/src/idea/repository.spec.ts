import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IdeaError,
  parseIdea,
  renderIdea,
  withIssue,
  withOutcome,
} from "./record.js";
import { IdeaRepository } from "./repository.js";
import {
  fakeClock,
  fakeFileSystem,
  recordFixture,
  type FakeFileSystem,
} from "./idea-support.js";

// The record helpers are this domain's other units: mocked. The constants and
// IdeaError stay real, so the safety-pattern check runs for real.
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  parseIdea: vi.fn(),
  renderIdea: vi.fn(),
  withIssue: vi.fn(),
  withOutcome: vi.fn(),
}));

const ROOT = "/repo";
const INDEX_PATH = `${ROOT}/docs/index.md`;
const DIR = `${ROOT}/docs/ideas`;
const NEW_PATH = "docs/ideas/0004-probe.md";

const INDEX =
  "# Index\n\n## Decisions\n\n- x\n\n## Operations and Guides\n\n- y\n";

const IDEA = {
  title: "Probe",
  summary: "Cache the probe results",
  hypothesis: "Caching probes cuts up time.",
  expectedOutcome: "Up time drops by 20 percent.",
  measurement: "Compare kore local up duration in the ledger.",
  safetyPattern: "feature-flagged",
};

const eexist = () => Object.assign(new Error("exists"), { code: "EEXIST" });

function setup() {
  const fs: FakeFileSystem = fakeFileSystem();
  const clock = fakeClock();
  const repo = new IdeaRepository(fs, clock, ROOT);
  fs.exists.mockResolvedValue(true);
  return { fs, clock, repo };
}

beforeEach(() => {
  vi.mocked(parseIdea).mockImplementation((path) =>
    recordFixture({ path, number: "0001", slug: "probe" }),
  );
  vi.mocked(renderIdea).mockReturnValue("RENDERED");
});

describe("IdeaRepository.list", () => {
  it("reads and parses each idea file in number order, skipping other names", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0002-b.md", "notes.md", "0001-a.md"]);
    fs.readFile.mockImplementation((path) =>
      Promise.resolve(`text of ${path}`),
    );
    await repo.list();
    expect(fs.readdir.mock.calls).toEqual([[DIR]]);
    expect(fs.readFile.mock.calls).toEqual([
      [`${DIR}/0001-a.md`],
      [`${DIR}/0002-b.md`],
    ]);
    expect(vi.mocked(parseIdea).mock.calls).toEqual([
      ["docs/ideas/0001-a.md", `text of ${DIR}/0001-a.md`],
      ["docs/ideas/0002-b.md", `text of ${DIR}/0002-b.md`],
    ]);
  });

  it("returns nothing and reads nothing when there is no ideas directory", async () => {
    const { fs, repo } = setup();
    fs.exists.mockImplementation((path) => Promise.resolve(path !== DIR));
    expect(await repo.list()).toEqual([]);
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

describe("IdeaRepository.get", () => {
  it.each(["1", "0001", "probe", "0001-probe"])(
    "finds the idea for the reference %s and parses its file",
    async (ref) => {
      const { fs, repo } = setup();
      fs.readdir.mockResolvedValue(["0001-probe.md", "0002-other.md"]);
      fs.readFile.mockResolvedValue("TEXT");
      await repo.get(ref);
      expect(fs.readFile.mock.calls).toEqual([[`${DIR}/0001-probe.md`]]);
      expect(vi.mocked(parseIdea).mock.calls).toEqual([
        ["docs/ideas/0001-probe.md", "TEXT"],
      ]);
    },
  );

  it("names the list and new commands when nothing matches the reference", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0001-probe.md"]);
    await expect(repo.get("9")).rejects.toThrow(
      new IdeaError(
        'No idea matches "9". Run `harness idea list` to see the ideas, or `harness idea new` to create one.',
      ),
    );
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("fails the same way when the ideas directory does not exist", async () => {
    const { fs, repo } = setup();
    fs.exists.mockResolvedValue(false);
    await expect(repo.get("1")).rejects.toThrow(/No idea matches "1"/);
  });
});

describe("IdeaRepository.create validation", () => {
  it("refuses when the knowledge index is missing, naming the root to set", async () => {
    const { fs, repo } = setup();
    fs.exists.mockImplementation((path) =>
      Promise.resolve(path !== INDEX_PATH),
    );
    await expect(repo.create("probe", IDEA)).rejects.toThrow(
      new IdeaError(
        `docs/index.md not found under /repo; set CLAUDE_PROJECT_DIR to the repository root.`,
      ),
    );
    expect(fs.createFile).not.toHaveBeenCalled();
    expect(fs.readdir).not.toHaveBeenCalled();
  });

  it("refuses an unknown safety pattern before reading or writing any idea", async () => {
    const { fs, repo } = setup();
    await expect(
      repo.create("probe", { ...IDEA, safetyPattern: "yolo" }),
    ).rejects.toThrow(
      '--safety-pattern "yolo" is not recognised; use one of no-behaviour-change, feature-flagged, dark-launched, branch-by-abstraction, expand-contract.',
    );
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.createFile).not.toHaveBeenCalled();
  });
});

describe("IdeaRepository.create numbering and indexing", () => {
  it("allocates the next number after the highest, writes the file and indexes it", async () => {
    const { fs, clock, repo } = setup();
    fs.readdir.mockResolvedValue(["0002-old.md", "0003-older.md"]);
    fs.readFile.mockResolvedValue(INDEX);
    const created = await repo.create("probe", IDEA);
    expect(vi.mocked(renderIdea).mock.calls).toEqual([
      ["0004", "2026-03-04", IDEA],
    ]);
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(fs.createFile.mock.calls).toEqual([
      [`${ROOT}/${NEW_PATH}`, "RENDERED"],
    ]);
    expect(fs.writeFile.mock.calls).toEqual([
      [INDEX_PATH, indexWithEntry(INDEX, NEW_PATH, IDEA.summary)],
    ]);
    expect(created.created).toBe(true);
  });

  it("returns an existing slug untouched and reports it not created", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0001-probe.md"]);
    fs.readFile.mockImplementation((path) =>
      Promise.resolve(path === INDEX_PATH ? INDEX : "TEXT"),
    );
    const result = await repo.create("probe", IDEA);
    expect(result.created).toBe(false);
    expect(fs.createFile).not.toHaveBeenCalled();
  });

  it("repairs a half-finished create by indexing an existing record that has no entry", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0001-probe.md"]);
    fs.readFile.mockImplementation((path) =>
      Promise.resolve(path === INDEX_PATH ? INDEX : "TEXT"),
    );
    await repo.create("probe", IDEA);
    expect(fs.writeFile.mock.calls).toEqual([
      [
        INDEX_PATH,
        indexWithEntry(
          INDEX,
          "docs/ideas/0001-probe.md",
          "Cache the probe results",
        ),
      ],
    ]);
  });

  it("leaves the index alone when an existing record is already listed in it", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0001-probe.md"]);
    fs.readFile.mockImplementation((path) =>
      Promise.resolve(
        path === INDEX_PATH ? `${INDEX}- [x](ideas/0001-probe.md)\n` : "TEXT",
      ),
    );
    await repo.create("probe", IDEA);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("IdeaRepository.create collisions", () => {
  it("creates the file exclusively and retries with the next number on a collision", async () => {
    const { fs, repo } = setup();
    fs.readdir
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["0001-other.md"]);
    fs.createFile
      .mockRejectedValueOnce(eexist())
      .mockResolvedValueOnce(undefined);
    fs.readFile.mockResolvedValue(INDEX);
    await repo.create("probe", IDEA);
    expect(fs.createFile.mock.calls.map(([path]) => path)).toEqual([
      `${ROOT}/docs/ideas/0001-probe.md`,
      `${ROOT}/docs/ideas/0002-probe.md`,
    ]);
  });

  it("rethrows a write failure that is not a collision", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue([]);
    fs.createFile.mockRejectedValue(new Error("disk full"));
    await expect(repo.create("probe", IDEA)).rejects.toThrow("disk full");
    expect(fs.createFile).toHaveBeenCalledTimes(1);
  });

  it("gives up after three colliding attempts and says to rerun later", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue([]);
    fs.createFile.mockRejectedValue(eexist());
    await expect(repo.create("probe", IDEA)).rejects.toThrow(
      "Another writer keeps creating ideas in docs/ideas; rerun `harness idea new` once it finishes.",
    );
    expect(fs.createFile).toHaveBeenCalledTimes(3);
  });
});

describe("IdeaRepository writes to one record", () => {
  it("reads the raw markdown of a record under the root", async () => {
    const { fs, repo } = setup();
    fs.readFile.mockResolvedValue("RAW");
    expect(await repo.source(recordFixture())).toBe("RAW");
    expect(fs.readFile.mock.calls).toEqual([
      [`${ROOT}/docs/ideas/0001-cache-the-probe-results.md`],
    ]);
  });

  it("records the issue through withIssue and writes the result back", async () => {
    const { fs, repo } = setup();
    fs.readFile.mockResolvedValue("OLD");
    vi.mocked(withIssue).mockReturnValue("WITH ISSUE");
    await repo.recordIssue(recordFixture(), "https://x/issues/1");
    expect(vi.mocked(withIssue).mock.calls).toEqual([
      ["OLD", "https://x/issues/1"],
    ]);
    expect(fs.writeFile.mock.calls).toEqual([
      [`${ROOT}/docs/ideas/0001-cache-the-probe-results.md`, "WITH ISSUE"],
    ]);
  });

  it("records the outcome through withOutcome and writes the result back", async () => {
    const { fs, repo } = setup();
    fs.readFile.mockResolvedValue("OLD");
    vi.mocked(withOutcome).mockReturnValue("WITH OUTCOME");
    await repo.recordOutcome(recordFixture(), "refuted", "## Outcome\n\nNo.");
    expect(vi.mocked(withOutcome).mock.calls).toEqual([
      ["OLD", "refuted", "## Outcome\n\nNo."],
    ]);
    expect(fs.writeFile.mock.calls).toEqual([
      [`${ROOT}/docs/ideas/0001-cache-the-probe-results.md`, "WITH OUTCOME"],
    ]);
  });
});

describe("IdeaRepository indexes new entries in the layout it finds", () => {
  const ENTRY =
    "- [`docs/ideas/0001-probe.md`](ideas/0001-probe.md) — Cache the probe results";

  it("appends the entry under an existing Ideas section, before the blank lines that precede the next heading", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0001-probe.md"]);
    const index =
      "# Index\n\n## Ideas\n\n- old\n\n## Operations and Guides\n\n- y\n";
    fs.readFile.mockImplementation((path) =>
      Promise.resolve(path === INDEX_PATH ? index : "TEXT"),
    );
    await repo.create("probe", IDEA);
    expect(fs.writeFile.mock.calls).toEqual([
      [
        INDEX_PATH,
        `# Index\n\n## Ideas\n\n- old\n${ENTRY}\n\n## Operations and Guides\n\n- y\n`,
      ],
    ]);
  });

  it("starts an Ideas section at the end of an index that has no later section", async () => {
    const { fs, repo } = setup();
    fs.readdir.mockResolvedValue(["0001-probe.md"]);
    fs.readFile.mockImplementation((path) =>
      Promise.resolve(
        path === INDEX_PATH ? "# Index\n\n## Decisions\n\n- x" : "TEXT",
      ),
    );
    await repo.create("probe", IDEA);
    expect(fs.writeFile.mock.calls[0]?.[1]).toContain(`## Ideas\n\n${ENTRY}`);
  });
});

/** The index as addEntry leaves it: the entry appended under a new Ideas heading before Operations and Guides. */
function indexWithEntry(index: string, path: string, summary: string): string {
  const entry = `- [\`${path}\`](${path.replace(/^docs\//, "")}) — ${summary}`;
  return index.replace(
    "## Operations and Guides",
    `## Ideas\n\n${entry}\n\n## Operations and Guides`,
  );
}

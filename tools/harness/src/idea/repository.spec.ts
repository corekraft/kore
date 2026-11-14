import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaError, parseIdea, renderIdea } from "./record.js";
import {
  DIR,
  IDEA,
  INDEX,
  INDEX_PATH,
  NEW_PATH,
  ROOT,
  defaultMocks,
  setup,
} from "./repository-support.js";

// The record helpers are this domain's other units: mocked. The constants and
// IdeaError stay real, so the safety-pattern check runs for real.
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  parseIdea: vi.fn(),
  renderIdea: vi.fn(),
  withIssue: vi.fn(),
  withOutcome: vi.fn(),
}));

beforeEach(defaultMocks);

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

function indexWithEntry(index: string, path: string, summary: string): string {
  const entry = `- [\`${path}\`](${path.replace(/^docs\//, "")}) — ${summary}`;
  return index.replace(
    "## Operations and Guides",
    `## Ideas\n\n${entry}\n\n## Operations and Guides`,
  );
}

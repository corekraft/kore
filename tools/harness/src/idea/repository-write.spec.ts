import { beforeEach, describe, expect, it, vi } from "vitest";
import { withIssue, withOutcome } from "./record.js";
import { recordFixture } from "./idea-support.js";
import {
  IDEA,
  INDEX,
  INDEX_PATH,
  ROOT,
  defaultMocks,
  eexist,
  setup,
} from "./repository-support.js";

vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  parseIdea: vi.fn(),
  renderIdea: vi.fn(),
  withIssue: vi.fn(),
  withOutcome: vi.fn(),
}));

beforeEach(defaultMocks);

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

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATH,
  context,
  prepareCommands,
  show,
  list,
} from "./commands-support.js";
import type { FakeDeps, FakeRepository } from "./idea-support.js";
import { recordFixture } from "./idea-support.js";
import { IdeaError } from "./record.js";

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

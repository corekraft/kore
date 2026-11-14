import { beforeEach, describe, expect, it, vi } from "vitest";
import { URL, context, prepareCommands, sync } from "./commands-support.js";
import type { FakeDeps, FakeRepository } from "./idea-support.js";
import { recordFixture } from "./idea-support.js";
import { syncIssue } from "./sync.js";

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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRunner, recordFixture, type FakeRunner } from "./idea-support.js";
import type { IdeaRecord } from "./record.js";
import { withoutOutcome } from "./record.js";
import { syncIssue, type SyncOptions } from "./sync.js";
import {
  ROOT,
  TEXT,
  URL,
  createArgs,
  editArgs,
  reply,
  repoName,
  view,
} from "./sync-support.js";

// withoutOutcome is this domain's other unit: mocked, as in sync.spec.ts.
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  withoutOutcome: vi.fn(),
}));

const harness = recordFixture({
  harness: {
    metric: "tokensByStagePerMergedChange.current",
    direction: "down",
    window: "14d",
  },
});

const sync = (
  runner: FakeRunner,
  record: IdeaRecord,
  options?: Pick<SyncOptions, "harnessLabel">,
) => syncIssue(runner, ROOT, record, TEXT, { recordLink: vi.fn(), ...options });

/** The argument list of every gh call the sync made, in order. */
const calls = (runner: FakeRunner) =>
  runner.run.mock.calls.map(([, args]) => args);

beforeEach(() => {
  vi.mocked(withoutOutcome).mockImplementation((text: string) => text);
});

describe("syncIssue with the harness label option on", () => {
  it("creates a harness idea's issue with the harness label", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply(`${URL}\n`));
    await sync(runner, harness, { harnessLabel: true });
    expect(calls(runner)[1]).toEqual([
      ...createArgs("corekraft/kore", "Cache the probe results"),
      "--label",
      "harness",
    ]);
  });

  it("adds the harness label when it edits an existing harness idea's issue", async () => {
    const runner = fakeRunner();
    const linked = {
      ...harness,
      issue: "https://github.com/other/repo/issues/5",
    };
    runner.run
      .mockResolvedValueOnce(view("Old title", "old body"))
      .mockResolvedValueOnce(reply(""));
    expect(await sync(runner, linked, { harnessLabel: true })).toEqual({
      action: "updated",
      issue: "https://github.com/other/repo/issues/5",
    });
    expect(calls(runner)[1]).toEqual([
      ...editArgs("Cache the probe results"),
      "--add-label",
      "harness",
    ]);
  });

  it("never removes a label, on create or on edit", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(view("Old", "old"))
      .mockResolvedValueOnce(reply(""));
    await sync(runner, { ...harness, issue: "5" }, { harnessLabel: true });
    expect(calls(runner).flat()).not.toContain("--remove-label");
  });

  it("adds no label to an idea that is not of kind harness", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply(`${URL}\n`));
    await sync(runner, recordFixture(), { harnessLabel: true });
    expect(calls(runner)[1]).toEqual(
      createArgs("corekraft/kore", "Cache the probe results"),
    );
  });

  it("writes nothing for an issue that already matches, so it gains the label only on its next edit", async () => {
    const runner = fakeRunner();
    const body = (await import("./sync.js")).renderBody(harness, TEXT);
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(view("Cache the probe results", body));
    expect(
      await sync(runner, { ...harness, issue: "5" }, { harnessLabel: true }),
    ).toEqual({
      action: "unchanged",
      issue: "5",
    });
    expect(runner.run).toHaveBeenCalledTimes(2);
  });
});

describe("syncIssue with the harness label option off", () => {
  it("creates and edits exactly as before, with no label argument", async () => {
    const runner = fakeRunner();
    runner.run
      .mockResolvedValueOnce(repoName)
      .mockResolvedValueOnce(reply(`${URL}\n`));
    await sync(runner, harness);
    expect(calls(runner)[1]).toEqual(
      createArgs("corekraft/kore", "Cache the probe results"),
    );
  });
});

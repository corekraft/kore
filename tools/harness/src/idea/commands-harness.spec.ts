// harness idea show for a harness idea (#214).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { context, prepareCommands, show } from "./commands-support.js";
import type { FakeDeps, FakeRepository } from "./idea-support.js";
import { recordFixture } from "./idea-support.js";

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

describe("harness idea show for a harness idea", () => {
  it("prints a harness idea's metric, direction and window after the safety pattern", async () => {
    repo.get.mockResolvedValue(
      recordFixture({
        harness: { metric: "friction.total", direction: "down", window: "14d" },
      }),
    );
    await show.run(context(deps, { idea: "1" }));
    expect(deps.stdout.mock.calls[0]?.[0]).toContain(
      "Safety pattern: feature-flagged\nHarness hypothesis: friction.total down within 14d\nFile:",
    );
  });

  it("prints the harness block as JSON under --json", async () => {
    const harness = {
      metric: "friction.total",
      direction: "down" as const,
      window: "14d",
    };
    repo.get.mockResolvedValue(recordFixture({ harness }));
    await show.run(context(deps, { idea: "1" }, true));
    expect(deps.stdout.mock.calls).toEqual([
      [JSON.stringify(recordFixture({ harness })) + "\n"],
    ]);
  });
});

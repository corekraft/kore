// harness idea new and show for a model-tier idea (#218).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIELDS,
  context,
  create,
  prepareCommands,
  show,
} from "./commands-support.js";
import type { FakeDeps, FakeRepository } from "./idea-support.js";
import { recordFixture } from "./idea-support.js";
import { IdeaError } from "./record.js";
import { attachTier, tierFromFlags } from "./tier.js";

vi.mock("../flow/index.js", () => ({ flowMetricNames: vi.fn(() => []) }));
vi.mock("./repository.js");
vi.mock("./sync.js");
vi.mock("./tier.js");
vi.mock("./record.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./record.js")>()),
  harnessHypothesis: vi.fn(),
  scalar: vi.fn(),
}));

let deps: FakeDeps;
let repo: FakeRepository;
const TIER = { fields: ["model"], guardMetric: "g" };

beforeEach(() => {
  ({ deps, repo } = prepareCommands());
  vi.mocked(attachTier).mockImplementation((harness) => harness);
});

describe("harness idea new for a tier idea", () => {
  it("reads the tier flags and attaches the tier to the hypothesis", async () => {
    const harness = { metric: "m", direction: "down" as const, window: "14d" };
    const tiered = { ...harness, tier: TIER };
    vi.mocked(tierFromFlags).mockReturnValue(TIER);
    vi.mocked(attachTier).mockReturnValue(tiered);
    repo.create.mockResolvedValue({ created: true, record: recordFixture() });
    await create.run(
      context(deps, {
        ...FIELDS,
        "tier-change": "model",
        "guard-metric": "g",
      }),
    );
    expect(vi.mocked(tierFromFlags).mock.calls).toEqual([
      [{ tierChange: "model", guardMetric: "g" }],
    ]);
    expect(repo.create.mock.calls[0]?.[1]).toMatchObject({ harness: tiered });
  });

  it("reports a tier idea with only a cost metric on stderr and writes nothing", async () => {
    vi.mocked(tierFromFlags).mockImplementation(() => {
      throw new IdeaError("A tier idea is missing --guard-metric");
    });
    expect(
      await create.run(context(deps, { ...FIELDS, "tier-change": "model" })),
    ).toBe(1);
    expect(deps.stderr.mock.calls).toEqual([
      ["A tier idea is missing --guard-metric\n"],
    ]);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("harness idea show for a tier idea", () => {
  it("prints the changed fields and the guard metric after the hypothesis", async () => {
    repo.get.mockResolvedValue(
      recordFixture({
        harness: {
          metric: "metrics.tokensPerIdea",
          direction: "down",
          window: "14d",
          tier: { fields: ["model", "effort"], guardMetric: "rework.x" },
        },
      }),
    );
    await show.run(context(deps, { idea: "1" }));
    expect(deps.stdout.mock.calls[0]?.[0]).toContain(
      "Harness hypothesis: metrics.tokensPerIdea down within 14d\nTier change: model, effort, guarded by rework.x\nFile:",
    );
  });
});

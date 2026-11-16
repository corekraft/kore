// harness evaluate for a model-tier idea (#218): both metrics are reported, and a refuted tier change reverts like any other.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateIdea } from "../evaluate/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { evaluateCommand } from "./evaluate-commands.js";
import { openLedger } from "./ledger-commands.js";
import { logOutcome } from "./outcome-commands.js";
import { prepareRevertFor } from "./revert-commands.js";

vi.mock("../evaluate/index.js");
vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
}));
vi.mock("./ledger-commands.js");
vi.mock("./outcome-commands.js");
vi.mock("./revert-commands.js");

const ISSUE = "https://github.com/corekraft/kore/issues/300";
const GUARD = "rework.sendBacksPerIdea";

function recorded(result: "refuted" | "confirmed") {
  return {
    status: "recorded" as const,
    idea: "0007",
    result,
    before: 100,
    after: 70,
    guard: { metric: GUARD, before: 2, after: result === "refuted" ? 5 : 2 },
    changedByPr: 41,
    concluded: {
      idea: "0007",
      result,
      issue: ISSUE,
      published: { commented: true, labelled: true, closed: true },
    },
  };
}

function run(json = false) {
  const deps = {
    root: vi.fn(() => Promise.resolve("a-root")),
    runner: { run: vi.fn() },
    clock: {
      now: vi.fn(() => new Date("2026-11-14T08:30:00Z")),
      sleep: vi.fn(),
    },
    fs: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
    env: { KORE_ROLE: "orchestrator", KORE_AGENT: "queue-x" },
  };
  return {
    deps,
    result: evaluateCommand.run(contextWith(deps, { idea: "7" }, json)),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openLedger).mockResolvedValue({
    ledger: fakeLedger([] as LedgerEvent[]).ledger,
  });
  vi.mocked(prepareRevertFor).mockResolvedValue({ status: "flag-off" });
});

describe("harness evaluate for a tier idea", () => {
  it("prints the send-backs figures beside the cost figures", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue(recorded("refuted"));
    const { deps, result } = run();
    expect(await result).toBe(0);
    expect(deps.stdout).toHaveBeenCalledWith(
      `Idea 0007 refuted (100 to 70); ${GUARD} 2 to 5; issue closed: ${ISSUE}\nNo revert prepared: the automatic-revert flag is off in the local overlay.\n`,
    );
  });

  it("hands a refuted tier change to the revert, which prepares nothing for a confirmed one", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue(recorded("refuted"));
    await run().result;
    expect(prepareRevertFor).toHaveBeenCalledTimes(1);
    expect(logOutcome).toHaveBeenCalledTimes(1);
  });

  it("prints the guard figures in --json", async () => {
    vi.mocked(evaluateIdea).mockResolvedValue(recorded("confirmed"));
    vi.mocked(prepareRevertFor).mockResolvedValue({ status: "not-refuted" });
    const { deps, result } = run(true);
    await result;
    const printed = JSON.parse(String(deps.stdout.mock.calls[0]?.[0])) as {
      guard: unknown;
      result: string;
    };
    expect(printed.result).toBe("confirmed");
    expect(printed.guard).toEqual({ metric: GUARD, before: 2, after: 2 });
  });
});

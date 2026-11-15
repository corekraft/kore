// The judge's checklist wiring: reading item modes from the inventory and writing
// one ledger event per audit firing. Every collaborator is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardrailError, readInventory } from "../guardrail/index.js";
import { JudgeError, modesFrom, ENFORCE_ALL } from "../judge/index.js";
import { bundleMainRoot } from "../runtime/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { checklistModes, recordAudits } from "./judge-checklist.js";
import { openJudgeLedger } from "./judge-shared.js";
import { reportOf } from "./judge-command-support.js";

vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  readInventory: vi.fn(),
}));
vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  modesFrom: vi.fn(),
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  bundleMainRoot: vi.fn(),
}));
vi.mock("./judge-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./judge-shared.js")>()),
  openJudgeLedger: vi.fn(),
}));

const CLOCK = { now: () => new Date("2026-01-02T03:04:05Z") };
const readFile = vi.fn();
const context = () =>
  contextWith({ fs: { readFile }, clock: CLOCK }, {}, false);

const SCAN = {
  item: "scan",
  rule: "judge-scan",
  mode: "audit",
  result: "fail",
} as const;
const FIRING = "judge.audit:42:abc1234:judge-scan";

function ledgerWith(
  events: { id: string }[] = [],
  result?: Parameters<typeof fakeLedger>[1],
) {
  const fake = fakeLedger(events, result);
  vi.mocked(openJudgeLedger).mockResolvedValue(fake.ledger);
  return fake;
}

beforeEach(() => {
  vi.mocked(bundleMainRoot).mockResolvedValue("/main");
});

describe("checklistModes", () => {
  it("reads the inventory of the main checkout, never the working directory's, and returns its item modes", async () => {
    const inventory = { guardrails: [] };
    vi.mocked(readInventory).mockResolvedValue(inventory);
    const modes = { ...ENFORCE_ALL, scan: "audit" } as const;
    vi.mocked(modesFrom).mockReturnValue(modes);
    expect(await checklistModes(context())).toBe(modes);
    expect(readInventory).toHaveBeenCalledWith(expect.any(Function), "/main");
    expect(modesFrom).toHaveBeenCalledWith(inventory);
  });

  it("refuses an unreadable inventory with an actionable error, never reading every item as enforce", async () => {
    vi.mocked(readInventory).mockRejectedValue(
      new GuardrailError(
        ".claude/guardrails.yaml: guardrails[3].mode must be audit or enforce.",
      ),
    );
    await expect(checklistModes(context())).rejects.toThrow(
      new JudgeError(
        ".claude/guardrails.yaml: guardrails[3].mode must be audit or enforce. The judge reads each checklist item's mode from the inventory; fix it, then rerun.",
      ),
    );
    expect(modesFrom).not.toHaveBeenCalled();
  });

  it("rethrows an error it did not expect", async () => {
    const bug = new Error("bug");
    vi.mocked(readInventory).mockRejectedValue(bug);
    await expect(checklistModes(context())).rejects.toBe(bug);
  });

  it("refuses when the main checkout is unknown, and says how to fix it", async () => {
    vi.mocked(bundleMainRoot).mockResolvedValue(undefined);
    await expect(checklistModes(context())).rejects.toThrow(
      "Cannot find the main checkout from the harness bundle's location, so there is no guardrail inventory to read checklist modes from. Run the built skills/bin/harness.mjs (mise run harness-build) from inside the repository.",
    );
  });
});

describe("recordAudits", () => {
  it("writes one guard.audit event per failing audit item, labelled with its rule, through the ledger", async () => {
    const ledger = ledgerWith();
    await recordAudits(
      context(),
      reportOf({
        idea: "#193",
        audited: [SCAN, { ...SCAN, item: "ci", rule: "judge-ci" }],
      }),
    );
    expect(ledger.write.mock.calls).toEqual([
      [
        {
          source: "github",
          kind: "guard.audit",
          occurredAt: "2026-01-02T03:04:05.000Z",
          label: "judge-scan",
          id: FIRING,
          idea: "#193",
        },
      ],
      [
        expect.objectContaining({
          label: "judge-ci",
          id: "judge.audit:42:abc1234:judge-ci",
        }),
      ],
    ]);
  });

  it("writes nothing when no audit item failed", async () => {
    const ledger = ledgerWith();
    await recordAudits(context(), reportOf({ audited: [] }));
    await recordAudits(context(), reportOf());
    expect(ledger.write).not.toHaveBeenCalled();
  });

  it("writes a firing once, so a rerun at the same head adds nothing", async () => {
    const ledger = ledgerWith([{ id: FIRING }]);
    await recordAudits(context(), reportOf({ audited: [SCAN] }));
    expect(ledger.write).not.toHaveBeenCalled();
  });

  it("writes the firing again at a new head, which is a new firing", async () => {
    const ledger = ledgerWith([{ id: FIRING }]);
    await recordAudits(
      context(),
      reportOf({ head: "def5678", audited: [SCAN] }),
    );
    expect(ledger.write.mock.calls[0]?.[0]).toMatchObject({
      id: "judge.audit:42:def5678:judge-scan",
    });
  });

  it("leaves out an idea that is not a plain reference", async () => {
    const ledger = ledgerWith();
    await recordAudits(
      context(),
      reportOf({ idea: "bad idea!", audited: [SCAN] }),
    );
    expect(ledger.write.mock.calls[0]?.[0]).not.toHaveProperty("idea");
  });

  it("refuses a rejected event, and says to rerun the precheck", async () => {
    ledgerWith([], { ok: false, field: "label", message: "full" });
    await expect(
      recordAudits(context(), reportOf({ audited: [SCAN] })),
    ).rejects.toThrow(
      "The precheck ran, but the ledger event for audit item judge-scan was rejected: full Fix the ledger, then rerun `harness judge precheck 42`.",
    );
  });
});

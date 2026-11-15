// The judge's checklist wiring in judge-shared: item modes read from the inventory,
// and one ledger event per audit firing. The collaborators outside the unit are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardrailError, readInventory } from "../guardrail/index.js";
import {
  JudgeError,
  applyChecklist,
  modesFrom,
  precheck,
  type ItemModes,
} from "../judge/index.js";
import { Ledger } from "../ledger/index.js";
import { bundleMainRoot } from "../runtime/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { CLOCK, reportOf } from "./judge-command-support.js";
import { checkedPrecheck, checklistModes, record } from "./judge-shared.js";

vi.mock("node:path");
vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  readInventory: vi.fn(),
}));
vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  applyChecklist: vi.fn(),
  modesFrom: vi.fn(),
  precheck: vi.fn(),
}));
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  Ledger: vi.fn(),
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  bundleMainRoot: vi.fn(),
}));

const MODES = { scan: "audit" } as unknown as ItemModes;
const SCAN = {
  item: "scan",
  rule: "judge-scan",
  mode: "audit",
  result: "fail",
} as const;
const FIRING = "judge.audit:42:abc1234:judge-scan";
const readFile = vi.fn();
const context = () =>
  contextWith({ fs: { readFile }, clock: CLOCK }, {}, false);

function ledgerWith(
  events: { id?: string; label?: string; number?: number }[] = [],
  result?: Parameters<typeof fakeLedger>[1],
) {
  const fake = fakeLedger(events, result);
  vi.mocked(Ledger).mockImplementation(function () {
    return fake.ledger;
  });
  return fake;
}

beforeEach(() => {
  vi.mocked(bundleMainRoot).mockResolvedValue("/main");
});

describe("judge checklist modes", () => {
  it("reads the inventory of the main checkout, never the working directory's, and returns its item modes", async () => {
    const inventory = { guardrails: [] };
    vi.mocked(readInventory).mockResolvedValue(inventory);
    vi.mocked(modesFrom).mockReturnValue(MODES);
    expect(await checklistModes(context())).toBe(MODES);
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

describe("judge checked precheck", () => {
  it("reads the modes before the PR, then applies them to the precheck's report", async () => {
    const read = reportOf();
    const applied = reportOf({ audited: [SCAN] });
    vi.mocked(readInventory).mockResolvedValue({ guardrails: [] });
    vi.mocked(modesFrom).mockReturnValue(MODES);
    vi.mocked(precheck).mockResolvedValue(read);
    vi.mocked(applyChecklist).mockReturnValue(applied);
    const c = context();
    expect(await checkedPrecheck(c, "/r", "o/k", 42, ["bot"])).toBe(applied);
    expect(precheck).toHaveBeenCalledWith(c, "/r", "o/k", 42, ["bot"]);
    expect(applyChecklist).toHaveBeenCalledWith(read, MODES, new Set());
  });

  it("reads the activation events from the shared ledger only when the diff changes the inventory", async () => {
    const read = reportOf({ guardrailChanges: ["a:audit>enforce"] });
    const fake = ledgerWith([{ label: "a:audit>enforce" }, {}]);
    vi.mocked(readInventory).mockResolvedValue({ guardrails: [] });
    vi.mocked(modesFrom).mockReturnValue(MODES);
    vi.mocked(precheck).mockResolvedValue(read);
    vi.mocked(applyChecklist).mockReturnValue(read);
    await checkedPrecheck(context(), "/r", "o/k", 42, []);
    expect(fake.list.mock.calls).toEqual([[{ kind: "guardrail.activated" }]]);
    expect(applyChecklist).toHaveBeenCalledWith(
      read,
      MODES,
      new Set(["a:audit>enforce"]),
    );
  });

  it("opens no ledger when the diff leaves the inventory alone", async () => {
    vi.mocked(readInventory).mockResolvedValue({ guardrails: [] });
    vi.mocked(modesFrom).mockReturnValue(MODES);
    vi.mocked(precheck).mockResolvedValue(reportOf());
    vi.mocked(applyChecklist).mockReturnValue(reportOf());
    await checkedPrecheck(context(), "/r", "o/k", 42, []);
    expect(Ledger).not.toHaveBeenCalled();
  });

  it("reads no PR when the inventory is refused", async () => {
    vi.mocked(readInventory).mockRejectedValue(new GuardrailError("bad"));
    await expect(
      checkedPrecheck(context(), "/r", "o/k", 42, []),
    ).rejects.toThrow(JudgeError);
    expect(precheck).not.toHaveBeenCalled();
  });
});

describe("judge audit firings in the ledger", () => {
  it("writes one guard.audit event per failing audit item, labelled with its rule", async () => {
    const ledger = ledgerWith();
    await record(
      context(),
      reportOf({
        idea: "#193",
        audited: [SCAN, { ...SCAN, item: "ci", rule: "judge-ci" }],
      }),
    );
    const audits = ledger.write.mock.calls
      .map((c) => c[0])
      .filter((e) => (e as { kind?: string }).kind === "guard.audit");
    expect(audits).toEqual([
      {
        source: "github",
        kind: "guard.audit",
        occurredAt: "2026-01-02T03:04:05.000Z",
        label: "judge-scan",
        id: FIRING,
        idea: "#193",
      },
      expect.objectContaining({
        label: "judge-ci",
        id: "judge.audit:42:abc1234:judge-ci",
      }),
    ]);
  });

  it("writes no guard.audit event when no audit item failed", async () => {
    const ledger = ledgerWith();
    await record(context(), reportOf({ audited: [] }));
    await record(context(), reportOf());
    expect(ledger.write.mock.calls.map((c) => c[0])).not.toContainEqual(
      expect.objectContaining({ kind: "guard.audit" }),
    );
  });

  it("writes a firing once, so a rerun at the same head adds nothing, even when the verdict is unchanged", async () => {
    const ledger = ledgerWith([
      { id: FIRING },
      { number: 42, label: "none:pass" },
    ]);
    await record(context(), reportOf({ audited: [SCAN] }));
    expect(ledger.write).not.toHaveBeenCalled();
  });

  it("writes the firing again at a new head, which is a new firing", async () => {
    const ledger = ledgerWith([{ id: FIRING }]);
    await record(context(), reportOf({ head: "def5678", audited: [SCAN] }));
    expect(ledger.write.mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({ id: "judge.audit:42:def5678:judge-scan" }),
    );
  });

  it("leaves out an idea that is not a plain reference", async () => {
    const ledger = ledgerWith();
    await record(context(), reportOf({ idea: "bad idea!", audited: [SCAN] }));
    expect(ledger.write.mock.calls.at(-1)?.[0]).not.toHaveProperty("idea");
  });

  it("refuses a rejected audit event, naming the item and the fix", async () => {
    const ledger = ledgerWith();
    ledger.write
      .mockResolvedValueOnce({ ok: true, event: {} as never })
      .mockResolvedValue({ ok: false, field: "label", message: "full" });
    await expect(
      record(context(), reportOf({ audited: [SCAN] })),
    ).rejects.toThrow(
      "The precheck ran, but the ledger event for audit item judge-scan was rejected: full Fix the ledger, then rerun `harness judge precheck 42`.",
    );
  });
});

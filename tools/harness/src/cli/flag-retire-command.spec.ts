// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseManifest,
  readManifestText,
  remainingReferences,
  retireRefusals,
} from "../flag/index.js";
import type { ManifestEntry, RetireFacts } from "../flag/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";
import { fakeContext, NOW } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import { retireEdits } from "./flag-retire-edits.js";
import { retireFactsOf } from "./flag-retire-facts.js";
import { retire } from "./flag-retire-command.js";

vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  parseManifest: vi.fn(),
  readManifestText: vi.fn(),
  remainingReferences: vi.fn(),
  retireRefusals: vi.fn(),
}));
vi.mock("./ledger-commands.js");
vi.mock("./flag-retire-facts.js");
vi.mock("./flag-retire-edits.js");

const FLAG = "suborg-tenancy";
const FAILED = 1;
const MANIFEST_TEXT = '{ "retireSoakDays": 14, "flags": [] }';
const ENTRY: ManifestEntry = {
  name: FLAG,
  kind: "feature",
  applies: ["local"],
  requires: [],
  pending: false,
  notApplicable: [],
};

/** A ledger that records every event given to it, as the command's own record call sees it. */
function recordingLedger(accept = true) {
  const record = vi.fn((input: unknown) =>
    Promise.resolve(
      accept
        ? { ok: true as const, event: input }
        : { ok: false as const, field: "label", message: "bad label" },
    ),
  );
  return { record, ledger: { record, list: vi.fn() } as unknown as Ledger };
}

/** A command context for `flag retire` with the flag as operand. */
const retireContext = (overrides: Partial<CommandContext> = {}) =>
  fakeContext({ operand: FLAG, ...overrides });

const facts = (): RetireFacts => ({
  flag: FLAG,
  entry: ENTRY,
  environments: [],
  reverts: [],
  soakDays: 14,
  now: new Date(NOW),
});

let ledger = recordingLedger();

beforeEach(() => {
  ledger = recordingLedger();
  vi.mocked(readManifestText).mockResolvedValue(MANIFEST_TEXT);
  vi.mocked(parseManifest).mockReturnValue([ENTRY]);
  vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
  vi.mocked(retireFactsOf).mockResolvedValue(facts());
  vi.mocked(retireRefusals).mockReturnValue([]);
  vi.mocked(retireEdits).mockResolvedValue({
    overlays: [
      {
        path: "infra/environments/local/environment.yaml",
        text: "OVERLAY WITHOUT",
      },
    ],
    manifest: { path: "infra/catalog/flags.yaml", text: "MANIFEST WITHOUT" },
  });
  vi.mocked(remainingReferences).mockResolvedValue([]);
});

describe("flag retire refusals before any write", () => {
  it("refuses a command with no flag name, naming the usage, and writes nothing", async () => {
    const { context, writeFile, err } = retireContext({ operand: undefined });
    expect(await retire.run(context)).toBe(FAILED);
    expect(err()).toBe(
      "Missing flag name; run `harness flag retire <flag>`.\n",
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("refuses an ineligible flag, naming every reason, and writes and records nothing", async () => {
    vi.mocked(retireRefusals).mockReturnValue([
      `${FLAG} is off in local`,
      "the soak after 2026-11-01T00:00:00.000Z ends 2026-11-15T00:00:00.000Z and has not elapsed",
    ]);
    const { context, writeFile, err } = retireContext();
    expect(await retire.run(context)).toBe(FAILED);
    expect(err()).toBe(
      `${FLAG} is not eligible to retire: ${FLAG} is off in local; the soak after 2026-11-01T00:00:00.000Z ends 2026-11-15T00:00:00.000Z and has not elapsed. No file or ledger event was written.\n`,
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("refuses when the ledger cannot open, before the eligibility check or any write", async () => {
    vi.mocked(openLedger).mockResolvedValue({
      error: "No ledger; run the command from a repository.",
    });
    const { context, writeFile, err } = retireContext();
    expect(await retire.run(context)).toBe(FAILED);
    expect(err()).toBe("No ledger; run the command from a repository.\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("lets a soak that cannot be read stop the check before any write or event", async () => {
    vi.mocked(retireFactsOf).mockRejectedValue(new Error("no soak"));
    const { context, writeFile } = retireContext();
    await expect(retire.run(context)).rejects.toThrow("no soak");
    expect(writeFile).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });
});

describe("flag retire on an eligible flag: the writes", () => {
  it("writes each rewritten overlay and the manifest, then records one flag.retired event", async () => {
    const { context, writeFile } = retireContext();
    expect(await retire.run(context)).toBe(0);
    expect(writeFile).toHaveBeenCalledWith(
      "/repo/infra/environments/local/environment.yaml",
      "OVERLAY WITHOUT",
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/repo/infra/catalog/flags.yaml",
      "MANIFEST WITHOUT",
    );
    expect(ledger.record).toHaveBeenCalledTimes(1);
    expect(ledger.record).toHaveBeenCalledWith({
      source: "claude",
      kind: "flag.retired",
      occurredAt: NOW,
      label: FLAG,
    });
  });

  it("records the event only after the files are written, so a refused record leaves no event for an unwritten retirement", async () => {
    const order: string[] = [];
    const { context, writeFile } = retireContext();
    writeFile.mockImplementation(() => {
      order.push("write");
      return Promise.resolve();
    });
    ledger.record.mockImplementation((input) => {
      order.push("record");
      return Promise.resolve({ ok: true as const, event: input });
    });
    await retire.run(context);
    expect(order).toEqual(["write", "write", "record"]);
  });

  it("refuses a rejected event after the files are written, naming that the flag is retired", async () => {
    ledger = recordingLedger(false);
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    const { context, err } = retireContext();
    expect(await retire.run(context)).toBe(FAILED);
    expect(err()).toBe(
      `${FLAG} is retired, but its flag.retired ledger event was rejected: bad label. The files are already rewritten, so fix the ledger and do not rerun: a rerun finds nothing left to retire.\n`,
    );
  });
});

describe("flag retire on an eligible flag: the output", () => {
  it("prints the remaining references, one per line, for the writer to delete", async () => {
    vi.mocked(remainingReferences).mockResolvedValue([
      {
        path: "tools/kore/src/x.ts",
        line: 12,
        text: "flags: ['suborg-tenancy']",
      },
    ]);
    const { context, out } = retireContext();
    expect(await retire.run(context)).toBe(0);
    expect(remainingReferences).toHaveBeenCalledWith(
      context.deps.runner,
      "/repo",
      FLAG,
    );
    expect(out()).toBe(
      [
        `Retired flag ${FLAG}: removed from infra/environments/local/environment.yaml, infra/catalog/flags.yaml; flag.retired recorded.`,
        `Remaining references to ${FLAG} for the writer to delete:`,
        "  tools/kore/src/x.ts:12: flags: ['suborg-tenancy']",
        "",
      ].join("\n"),
    );
  });

  it("says so when no reference to the flag is left", async () => {
    const { context, out } = retireContext();
    await retire.run(context);
    expect(out()).toContain(`No remaining reference to ${FLAG}.`);
  });

  it("prints one JSON object with the rewritten files and the references with --json", async () => {
    vi.mocked(remainingReferences).mockResolvedValue([
      { path: "docs/a.md", line: 7, text: "see it" },
    ]);
    const { context, out } = retireContext({ json: true });
    expect(await retire.run(context)).toBe(0);
    expect(JSON.parse(out())).toEqual({
      flag: FLAG,
      retired: true,
      overlays: ["infra/environments/local/environment.yaml"],
      manifest: "infra/catalog/flags.yaml",
      references: [{ path: "docs/a.md", line: 7, text: "see it" }],
    });
  });

  it("builds the rewrites from the manifest text it judged, so the edit matches the check", async () => {
    const { context } = retireContext();
    await retire.run(context);
    expect(retireEdits).toHaveBeenCalledWith(
      context.deps.fs,
      "/repo",
      FLAG,
      MANIFEST_TEXT,
    );
  });
});

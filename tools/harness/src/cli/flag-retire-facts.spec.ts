// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordedProofs, environments, readOverlay } from "../flag/index.js";
import type { ManifestEntry } from "../flag/index.js";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import { NOW } from "./command-support.js";
import { retireFactsOf } from "./flag-retire-facts.js";
import { readRetireSoakDays } from "./flag-retire-soak.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
  recordedProofs: vi.fn(),
}));
vi.mock("./flag-retire-soak.js");

const FLAG = "suborg-tenancy";
const BASE = "/repo";
const ENTRY: ManifestEntry = {
  name: FLAG,
  kind: "feature",
  applies: ["local", "vps"],
  requires: [],
  pending: false,
  notApplicable: [],
};

/** A flag.activated or revert event as the ledger lists it. */
function event(kind: string, occurredAt: string, label?: string): LedgerEvent {
  return {
    kind,
    occurredAt,
    label,
    source: "claude",
    schema: 1,
    id: "id",
    recordedAt: occurredAt,
  } as unknown as LedgerEvent;
}

/** A ledger whose list answers each kind from the given events, and records the filter it was asked with. */
function ledgerWith(events: LedgerEvent[]) {
  const list = vi.fn((filter: { kind?: string }) =>
    Promise.resolve({
      events: events.filter((e) => e.kind === filter.kind),
      skipped: 0,
    }),
  );
  return { list, ledger: { list } as unknown as Ledger };
}

const clock = { now: () => new Date(NOW) } as unknown as Clock;
const fs = {} as FileSystem;

/** Inputs for the facts of FLAG, with the manifest entry the given overrides name. */
function inputs(
  ledger: Ledger,
  overrides: Partial<Parameters<typeof retireFactsOf>[0]> = {},
) {
  return {
    fs,
    clock,
    base: BASE,
    ledger,
    release: undefined,
    flag: FLAG,
    entry: ENTRY,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(readRetireSoakDays).mockResolvedValue(14);
  vi.mocked(environments).mockResolvedValue(["local", "vps"]);
  vi.mocked(readOverlay).mockImplementation((_fs, _base, name) =>
    Promise.resolve({
      environment: name,
      path: `infra/environments/${name}/environment.yaml`,
      text: "",
      features: { [FLAG]: true },
      production: name === "vps",
    }),
  );
  vi.mocked(recordedProofs).mockResolvedValue(
    new Map([[FLAG, { idea: "0001", path: "p", source: "live-run" }]]),
  );
});

describe("retireFactsOf", () => {
  it("reads each environment the flag applies to: whether it is on, proven and activated", async () => {
    const { ledger } = ledgerWith([
      event("flag.activated", "2026-11-01T00:00:00.000Z", `${FLAG}@local`),
      event("flag.activated", "2026-11-02T00:00:00.000Z", `${FLAG}@vps`),
    ]);
    const facts = await retireFactsOf(inputs(ledger));
    expect(facts.environments).toEqual([
      {
        name: "local",
        hasOverlay: true,
        on: true,
        proven: true,
        activated: "2026-11-01T00:00:00.000Z",
      },
      {
        name: "vps",
        hasOverlay: true,
        on: true,
        proven: true,
        activated: "2026-11-02T00:00:00.000Z",
      },
    ]);
  });

  it("reports an environment with no overlay as having none, and reads no overlay for it", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    const { ledger } = ledgerWith([]);
    const facts = await retireFactsOf(inputs(ledger));
    expect(facts.environments).toContainEqual({
      name: "vps",
      hasOverlay: false,
      on: false,
      proven: false,
      activated: undefined,
    });
    expect(readOverlay).not.toHaveBeenCalledWith(fs, BASE, "vps");
  });
});

describe("retireFactsOf: the ledger's activations and reverts", () => {
  it("takes the latest activation of the flag in an environment, not the first", async () => {
    const { ledger } = ledgerWith([
      event("flag.activated", "2026-11-09T00:00:00.000Z", `${FLAG}@local`),
      event("flag.activated", "2026-11-03T00:00:00.000Z", `${FLAG}@local`),
    ]);
    const facts = await retireFactsOf(inputs(ledger));
    expect(facts.environments[0]?.activated).toBe("2026-11-09T00:00:00.000Z");
  });

  it("ignores activations of other flags, and of this flag in other environments", async () => {
    const { ledger } = ledgerWith([
      event("flag.activated", "2026-11-01T00:00:00.000Z", "other-flag@local"),
      event("flag.activated", "2026-11-01T00:00:00.000Z", `${FLAG}@managed`),
    ]);
    const facts = await retireFactsOf(inputs(ledger));
    expect(facts.environments.map((e) => e.activated)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("retireFactsOf: the outcomes, the reverts and the soak", () => {
  it("reads whether each environment's recorded outcome counts, with its production mark", async () => {
    const { ledger } = ledgerWith([]);
    await retireFactsOf(inputs(ledger));
    expect(recordedProofs).toHaveBeenCalledWith(
      expect.anything(),
      "vps",
      undefined,
      true,
    );
    expect(recordedProofs).toHaveBeenCalledWith(
      expect.anything(),
      "local",
      undefined,
      false,
    );
  });

  it("collects the time of every main revert and harness change revert, the events that stop a soak", async () => {
    const { ledger, list } = ledgerWith([
      event("main.revert", "2026-11-05T00:00:00.000Z"),
      event("harness-change-reverted", "2026-11-06T00:00:00.000Z"),
    ]);
    const facts = await retireFactsOf(inputs(ledger));
    expect(facts.reverts).toEqual([
      "2026-11-05T00:00:00.000Z",
      "2026-11-06T00:00:00.000Z",
    ]);
    expect(list).toHaveBeenCalledWith({ kind: "main.revert" });
    expect(list).toHaveBeenCalledWith({ kind: "harness-change-reverted" });
  });

  it("reads the soak length from the harness config at the repository root, and passes it through", async () => {
    vi.mocked(readRetireSoakDays).mockResolvedValue(21);
    const { ledger } = ledgerWith([]);
    const facts = await retireFactsOf(inputs(ledger));
    expect(readRetireSoakDays).toHaveBeenCalledWith(fs, BASE);
    expect(facts.soakDays).toBe(21);
    expect(facts.now).toEqual(new Date(NOW));
    expect(facts.flag).toBe(FLAG);
  });

  it("refuses to gather facts when the soak cannot be read, so no flag is judged without one", async () => {
    vi.mocked(readRetireSoakDays).mockRejectedValue(new Error("no soak"));
    const { ledger } = ledgerWith([]);
    await expect(retireFactsOf(inputs(ledger))).rejects.toThrow("no soak");
  });

  it("lists no environment for a flag the manifest does not declare", async () => {
    const { ledger } = ledgerWith([]);
    const facts = await retireFactsOf(inputs(ledger, { entry: undefined }));
    expect(facts.entry).toBeUndefined();
    expect(facts.environments).toEqual([]);
  });

  it("leaves out an environment the entry marks not applicable", async () => {
    const { ledger } = ledgerWith([]);
    const facts = await retireFactsOf(
      inputs(ledger, { entry: { ...ENTRY, notApplicable: ["vps"] } }),
    );
    expect(facts.environments.map((e) => e.name)).toEqual(["local"]);
  });
});

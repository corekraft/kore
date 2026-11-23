// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outcomeSection } from "../idea/index.js";
import { fakeRepository, type FakeIdea } from "./flag-support.js";
import type { ProofSources, WindowRecord } from "./app-windows.js";
import { findProof } from "./proof.js";

vi.mock("../idea/index.js");

const APP_FLAG = "leads.new-checkout";
const PLATFORM_FLAG = "automatic-revert";
const ENVIRONMENT = "local";
const WINDOW_PATH = "infra/app-outcomes/local/leads.new-checkout/0001.json";

const window = (overrides: Partial<WindowRecord> = {}): WindowRecord => ({
  path: WINDOW_PATH,
  flag: APP_FLAG,
  environment: ENVIRONMENT,
  kind: "verification",
  result: "confirmed",
  ...overrides,
});

/** Sources that call the flag an app flag or not, and hold the given windows for it. */
function sources(isAppFlag: boolean, records: WindowRecord[]): ProofSources {
  return {
    isAppFlag: () => isAppFlag,
    windows: { list: vi.fn(() => Promise.resolve(records)) },
  };
}

const proven = (flag: string, source: string) => ({
  Result: "confirmed",
  Kind: "verification",
  Source: source,
  Flag: flag,
  Environment: ENVIRONMENT,
});

/** An outcome section as the tool writes it: the heading, then the field lines. */
function section(fields: Record<string, string>): string {
  return [
    "## Outcome",
    "",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
  ].join("\n");
}

const idea = (number: string, body: string): FakeIdea => ({
  number,
  path: `docs/ideas/${number}-proof.md`,
  text: body,
});

beforeEach(() => {
  vi.mocked(outcomeSection).mockImplementation((text) =>
    text === "" ? undefined : text,
  );
});

describe("findProof counts a platform window for an app flag", () => {
  it("returns the window for an app flag with a confirmed verification", async () => {
    const found = await findProof(
      fakeRepository([]),
      APP_FLAG,
      ENVIRONMENT,
      sources(true, [window()]),
    );
    expect(found).toEqual({ source: "platform-window", path: WINDOW_PATH });
  });

  it("returns none for a platform flag, even with the same window on record", async () => {
    const found = await findProof(
      fakeRepository([]),
      PLATFORM_FLAG,
      ENVIRONMENT,
      sources(false, [window({ flag: PLATFORM_FLAG })]),
    );
    expect(found).toBeUndefined();
  });

  it.each([
    ["a refuted result", { result: "refuted" as const }],
    ["an inconclusive result", { result: "inconclusive" as const }],
    ["another flag", { flag: "other.flag" }],
    ["another environment", { environment: "vps" }],
  ])("refuses a window with %s", async (_, change) => {
    const found = await findProof(
      fakeRepository([]),
      APP_FLAG,
      ENVIRONMENT,
      sources(true, [window(change)]),
    );
    expect(found).toBeUndefined();
  });

  it("finds no proof when the app flag has no window on record", async () => {
    const found = await findProof(
      fakeRepository([]),
      APP_FLAG,
      ENVIRONMENT,
      sources(true, []),
    );
    expect(found).toBeUndefined();
  });
});

describe("findProof orders a platform window beneath a live run and a waiver", () => {
  it("returns a live run over a platform window", async () => {
    const repo = fakeRepository([
      idea("0002", section(proven(APP_FLAG, "live-run"))),
    ]);
    expect(
      await findProof(repo, APP_FLAG, ENVIRONMENT, sources(true, [window()])),
    ).toEqual({
      idea: "0002",
      path: "docs/ideas/0002-proof.md",
      source: "live-run",
    });
  });

  it("returns an owner waiver over a platform window, so the waiver stays visible", async () => {
    const repo = fakeRepository([
      idea("0001", section(proven(APP_FLAG, "owner-waiver"))),
    ]);
    expect(
      await findProof(repo, APP_FLAG, ENVIRONMENT, sources(true, [window()])),
    ).toEqual({
      idea: "0001",
      path: "docs/ideas/0001-proof.md",
      source: "owner-waiver",
    });
  });
});

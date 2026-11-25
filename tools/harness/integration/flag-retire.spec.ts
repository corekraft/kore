// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import { Ledger } from "../src/ledger/index.js";
import {
  LEDGER,
  MANIFEST,
  OVERLAY,
  activate,
  harness,
  provenIdea,
  repository,
} from "../src/testing/index.js";

const FLAG = "ingress-agentgateway";
const IDEA = "docs/ideas/0001-proof.md";
const ACTIVATED = "2026-02-01T00:00:00.000Z";
const SOAKED = "2026-03-04T05:06:07.000Z";

/** The flag manifest with two feature flags that apply to local. */
const MANIFEST_TEXT = `${JSON.stringify(
  {
    flags: [
      { name: FLAG, kind: "feature", applies: ["local"] },
      { name: "other-flag", kind: "feature", applies: ["local"] },
    ],
  },
  null,
  2,
)}\n`;

/** The harness config, which sets the soak retirement waits for (ADR 0149). */
const HARNESS_CONFIG_TEXT = `${JSON.stringify({ retireSoakDays: 14 }, null, 2)}\n`;

type Harness = ReturnType<typeof harness>;

/** A command's deps with its clock at the given time; everything else is the fixture's. */
const at = (h: Harness, when: string) => ({
  ...h.deps,
  clock: { now: () => new Date(when), sleep: () => Promise.resolve() },
});

/** The ledger's events, read back as the ledger holds them; the fixture's get takes a path under its root. */
function eventsOf(h: Harness): Record<string, unknown>[] {
  return (h.get(".kore/state/ledger.jsonl") ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** A repository in which the flag was turned on at ACTIVATED, with its live-run proof recorded. */
async function activatedRepository(): Promise<Harness> {
  const h = repository({
    [IDEA]: provenIdea(),
    [MANIFEST]: MANIFEST_TEXT,
    ".claude/harness.json": HARNESS_CONFIG_TEXT,
  });
  expect(await run(activate(FLAG), at(h, ACTIVATED))).toBe(0);
  return h;
}

/** The retire command for a flag, reading the shared ledger the fixture holds at LEDGER. */
const retireArgs = (flag: string) => [
  "flag",
  "retire",
  flag,
  "--ledger",
  LEDGER,
];
const RETIRE = retireArgs(FLAG);

describe("harness flag retire on a flag that has soaked", () => {
  it("removes the flag from its overlay and from the manifest, keeping the other entries", async () => {
    const h = await activatedRepository();
    expect(await run(RETIRE, at(h, SOAKED))).toBe(0);
    expect(JSON.parse(h.get(OVERLAY) ?? "").features).toEqual({
      "other-flag": false,
    });
    const manifest = JSON.parse(h.get(MANIFEST) ?? "") as {
      flags: { name: string }[];
    };
    expect(manifest.flags.map((entry) => entry.name)).toEqual(["other-flag"]);
  });

  it("reads the soak from the harness config, which the retirement leaves as it was", async () => {
    const h = await activatedRepository();
    const config = h.get(".claude/harness.json");
    expect(await run(RETIRE, at(h, SOAKED))).toBe(0);
    expect(h.get(".claude/harness.json")).toBe(config);
  });

  it("records exactly one flag.retired event, and leaves the activation and the outcome record as they were", async () => {
    const h = await activatedRepository();
    const outcome = h.get(IDEA);
    const activation = eventsOf(h).filter(
      (event) => event["kind"] === "flag.activated",
    );
    expect(await run(RETIRE, at(h, SOAKED))).toBe(0);
    const retired = eventsOf(h).filter(
      (event) => event["kind"] === "flag.retired",
    );
    expect(retired).toEqual([
      expect.objectContaining({ source: "claude", label: FLAG }),
    ]);
    expect(eventsOf(h).filter((e) => e["kind"] === "flag.activated")).toEqual(
      activation,
    );
    expect(h.get(IDEA)).toBe(outcome);
  });

  it("prints the retirement and the remaining references, which here are none", async () => {
    const h = await activatedRepository();
    expect(await run(RETIRE, at(h, SOAKED))).toBe(0);
    expect(h.out()).toContain(`Retired flag ${FLAG}:`);
    expect(h.out()).toContain(`No remaining reference to ${FLAG}.`);
  });

  it("prints the same retirement as one JSON object with --json", async () => {
    const h = await activatedRepository();
    // The fixture's output holds the activation's text too, so only what the retirement printed is read.
    const printedBefore = h.out().length;
    expect(await run([...RETIRE, "--json"], at(h, SOAKED))).toBe(0);
    expect(JSON.parse(h.out().slice(printedBefore).trim())).toEqual({
      flag: FLAG,
      retired: true,
      overlays: [OVERLAY],
      manifest: MANIFEST,
      references: [],
    });
  });
});

describe("harness flag retire refusals write nothing", () => {
  it("refuses a flag whose soak has not elapsed, naming when it ends", async () => {
    const h = await activatedRepository();
    const before = h.snapshot();
    expect(await run(RETIRE, at(h, "2026-02-10T00:00:00.000Z"))).toBe(1);
    expect(h.err()).toContain(
      "the soak after 2026-02-01T00:00:00.000Z ends 2026-02-15T00:00:00.000Z and has not elapsed",
    );
    expect(h.snapshot()).toEqual(before);
  });

  it("refuses a flag reverted inside its soak, naming the revert", async () => {
    const h = await activatedRepository();
    await new Ledger(
      h.fs,
      at(h, SOAKED).clock,
      { next: () => "id-2" },
      LEDGER,
    ).record({
      source: "github",
      kind: "main.revert",
      occurredAt: "2026-02-05T00:00:00.000Z",
    });
    const before = h.snapshot();
    expect(await run(RETIRE, at(h, SOAKED))).toBe(1);
    expect(h.err()).toContain(
      "a revert was recorded at 2026-02-05T00:00:00.000Z, inside the soak after 2026-02-01T00:00:00.000Z",
    );
    expect(h.snapshot()).toEqual(before);
  });

  it("refuses a flag the manifest does not declare", async () => {
    const h = await activatedRepository();
    const before = h.snapshot();
    expect(await run(retireArgs("no-such-flag"), at(h, SOAKED))).toBe(1);
    expect(h.err()).toContain(
      "no-such-flag is not eligible to retire: no-such-flag is not declared in infra/catalog/flags.yaml",
    );
    expect(h.snapshot()).toEqual(before);
  });
});

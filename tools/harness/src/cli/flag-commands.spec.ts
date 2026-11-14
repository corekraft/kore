// Docs: docs/decisions/0077-live-proof-gates-activation-not-merge.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaRepository } from "../idea/index.js";
import {
  findProof,
  readOverlay,
  unprovenFlags,
  unprovenLine,
  withFlagOn,
} from "../flag/index.js";
import type { Command } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { flagCommands } from "./flag-commands.js";
import type { CommandContext } from "../runtime/index.js";
import { fakeContext, fakeLedger, NOW } from "./command-support.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("./ledger-commands.js");
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  findProof: vi.fn(),
  readOverlay: vi.fn(),
  unprovenFlags: vi.fn(),
  unprovenLine: vi.fn(),
  withFlagOn: vi.fn(),
}));

const FLAG = "ingress-agentgateway";
const PROOF = { idea: "0001", path: "docs/ideas/0001-proof.md" };
const FAILED = 1;
const OVERLAY = "infra/environments/local/environment.yaml";

/** A flag command's context: the flag as its operand, in the local environment. */
const flagContext = (overrides: Partial<CommandContext> = {}) =>
  fakeContext({
    options: { environment: "local" },
    operand: FLAG,
    ...overrides,
  });

function command(name: "activate" | "audit"): Command {
  const found = flagCommands[name];
  if (found === undefined) {
    throw new Error(`flag commands have no ${name} command`);
  }
  return found;
}

/** An overlay that declares the flag, off or on, in the local environment. */
function overlay(on: boolean) {
  return {
    environment: "local",
    path: OVERLAY,
    text: "",
    features: { [FLAG]: on },
  };
}

beforeEach(() => {
  vi.mocked(readOverlay).mockResolvedValue(overlay(false));
  vi.mocked(findProof).mockResolvedValue(PROOF);
  vi.mocked(withFlagOn).mockReturnValue("TURNED ON");
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
  vi.mocked(unprovenFlags).mockResolvedValue([]);
  vi.mocked(unprovenLine).mockImplementation((u) => `line ${u.flag}`);
});

describe("flag activate refusals before any write", () => {
  it("refuses a command with no flag name, naming the usage", async () => {
    const { context, writeFile, err } = flagContext({ operand: undefined });
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe(
      "Missing flag name; run `harness flag activate <flag> --environment <env>`.\n",
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ["no environment", {}],
    ["a blank environment", { environment: "  " }],
  ])("refuses %s, naming the usage", async (_, options) => {
    const { context, err } = flagContext({ options });
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toMatch(/^Missing --environment; run `harness flag activate/);
  });

  it("prints the error as a JSON line before the text with --json", async () => {
    const { context, err } = flagContext({ json: true, operand: undefined });
    expect(await command("activate").run(context)).toBe(FAILED);
    const message =
      "Missing flag name; run `harness flag activate <flag> --environment <env>`.";
    expect(err()).toBe(`${JSON.stringify({ error: message })}\n${message}\n`);
  });

  it("refuses a flag the overlay does not declare, listing the declared ones", async () => {
    vi.mocked(readOverlay).mockResolvedValue({
      ...overlay(false),
      features: { other: false },
    });
    const { context, err, writeFile } = flagContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toContain(
      `${OVERLAY} does not declare flag "${FLAG}". Declared: other. Declare it as false first.`,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("says none is declared when the overlay has no flags", async () => {
    vi.mocked(readOverlay).mockResolvedValue({
      ...overlay(false),
      features: {},
    });
    const { context, err } = flagContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toContain("Declared: none.");
  });

  it("refuses a flag with no verification outcome, and leaves the overlay unchanged", async () => {
    vi.mocked(findProof).mockResolvedValue(undefined);
    const { context, err, writeFile } = flagContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toContain(
      `No verification outcome records a live run of ${FLAG} in local, so ${OVERLAY} is unchanged.`,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("flag activate failures that leave the overlay alone", () => {
  it("fails with the flag still off when the ledger cannot be opened", async () => {
    vi.mocked(openLedger).mockResolvedValue({ error: "no ledger here" });
    const { context, err, writeFile } = flagContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe("no ledger here\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("names the failure of finding the repository root, whatever its type", async () => {
    const { context, deps, err } = flagContext();
    deps.root = () => Promise.reject("no checkout");
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe("no checkout\n");
  });

  it("rethrows an error that is not a flag error, so a bug is never reported as a refusal", async () => {
    vi.mocked(readOverlay).mockRejectedValue(new Error("disk on fire"));
    const { context } = flagContext();
    await expect(command("activate").run(context)).rejects.toThrow(
      "disk on fire",
    );
  });
});

describe("flag activate writes", () => {
  it("writes the overlay with the flag on, records the event, and prints the proof", async () => {
    const { context, writeFile, out } = flagContext();
    const ledger = fakeLedger();
    vi.mocked(openLedger).mockResolvedValue({ ledger: ledger.ledger });
    expect(await command("activate").run(context)).toBe(0);
    expect(writeFile.mock.calls).toEqual([["/repo/" + OVERLAY, "TURNED ON"]]);
    expect(ledger.write.mock.calls).toEqual([
      [
        {
          source: "claude",
          kind: "flag.activated",
          occurredAt: NOW,
          idea: "0001",
          label: `${FLAG}@local`,
        },
      ],
    ]);
    expect(out()).toBe(`Flag ${FLAG} is on in local; proof: ${PROOF.path}\n`);
  });

  it("prints the activation as one JSON line with --json", async () => {
    const { context, out } = flagContext({ json: true });
    vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
    expect(await command("activate").run(context)).toBe(0);
    expect(JSON.parse(out())).toEqual({
      flag: FLAG,
      environment: "local",
      idea: "0001",
      proof: PROOF.path,
    });
  });

  it("refuses a rejected ledger event after the overlay is written, naming the rerun", async () => {
    const rejected = fakeLedger([], {
      ok: false,
      field: "label",
      message: "bad label.",
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger: rejected.ledger });
    const { context, err } = flagContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe(
      `${FLAG} is on in local, but its ledger event was rejected: bad label. Fix the ledger, then rerun \`harness flag activate ${FLAG} --environment local\` to record it.\n`,
    );
  });

  it("does not rewrite a flag already on with its event recorded", async () => {
    vi.mocked(readOverlay).mockResolvedValue(overlay(true));
    const recorded = fakeLedger([{ label: `${FLAG}@local` }]);
    vi.mocked(openLedger).mockResolvedValue({ ledger: recorded.ledger });
    const { context, writeFile } = flagContext();
    expect(await command("activate").run(context)).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(recorded.write).not.toHaveBeenCalled();
  });

  it("repairs a missing event on a flag already on, without rewriting the overlay", async () => {
    vi.mocked(readOverlay).mockResolvedValue(overlay(true));
    const unrecorded = fakeLedger([]);
    vi.mocked(openLedger).mockResolvedValue({ ledger: unrecorded.ledger });
    const { context, writeFile } = flagContext();
    expect(await command("activate").run(context)).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(unrecorded.write).toHaveBeenCalledTimes(1);
  });
});

describe("flag audit", () => {
  it("passes and says so when no flag is on without proof", async () => {
    const { context, out, err } = flagContext({ operand: undefined });
    expect(await command("audit").run(context)).toBe(0);
    expect(out()).toBe("Flag audit passed: no flag is on without proof.\n");
    expect(err()).toBe("");
  });

  it("prints an empty list as JSON when it passes", async () => {
    const { context, out } = flagContext({ json: true, operand: undefined });
    expect(await command("audit").run(context)).toBe(0);
    expect(out()).toBe('{"unproven":[]}\n');
  });

  it("fails with one line per unproven flag on stderr", async () => {
    const unproven = [
      { flag: "a", environment: "local", path: OVERLAY },
      { flag: "b", environment: "local", path: OVERLAY },
    ];
    vi.mocked(unprovenFlags).mockResolvedValue(unproven);
    const { context, err, out } = flagContext({ operand: undefined });
    expect(await command("audit").run(context)).toBe(FAILED);
    expect(err()).toBe("line a\nline b\n");
    expect(out()).toBe("");
  });

  it("fails with the unproven list as JSON on stderr", async () => {
    const unproven = [{ flag: "a", environment: "local", path: OVERLAY }];
    vi.mocked(unprovenFlags).mockResolvedValue(unproven);
    const { context, err } = flagContext({ json: true, operand: undefined });
    expect(await command("audit").run(context)).toBe(FAILED);
    expect(err()).toBe(`${JSON.stringify({ unproven })}\n`);
  });

  it("reads the repository root from the deps, not the working directory", async () => {
    const { context, deps } = flagContext({ operand: undefined });
    deps.cwd = "/elsewhere";
    await command("audit").run(context);
    expect(unprovenFlags).toHaveBeenCalledWith(deps.fs, deps.clock, "/repo");
    expect(IdeaRepository).not.toHaveBeenCalled();
  });
});

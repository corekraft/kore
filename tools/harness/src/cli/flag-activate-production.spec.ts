// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationProof,
  flagRequires,
  isWaiverRefusal,
  readOverlay,
  proofAudit,
  unprovenLine,
  waivedLine,
  withFlagOn,
} from "../flag/index.js";
import type { Command } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { noOutcomeMessage } from "./flag-activate-messages.js";
import { flagCommands } from "./flag-commands.js";
import type { CommandContext } from "../runtime/index.js";
import { fakeContext, fakeLedger } from "./command-support.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("./ledger-commands.js");
vi.mock("./flag-activate-messages.js");
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  activationProof: vi.fn(),
  flagRequires: vi.fn(),
  isWaiverRefusal: vi.fn(),
  readOverlay: vi.fn(),
  proofAudit: vi.fn(),
  unprovenLine: vi.fn(),
  waivedLine: vi.fn(),
  withFlagOn: vi.fn(),
}));

const FLAG = "ingress-agentgateway";
const WAIVER_REFUSAL =
  "docs/ideas/0001-proof.md: an owner waiver is not accepted in production environment vps (ADR 0147), so a live run is required";
const CHART_REFUSAL =
  "docs/ideas/0002-proof.md: its main-lock charts differ from the release lock: cilium (version 9.9.9, release lock 1.0.0)";
const CHART_ADVICE = "--lock and --charts";
const PROOF = {
  idea: "0001",
  path: "docs/ideas/0001-proof.md",
  source: "live-run" as const,
};
const FAILED = 1;
const VPS_OVERLAY = "infra/environments/vps/environment.yaml";

/** A flag command's context: the flag as its operand, in the vps environment. */
const vpsContext = (overrides: Partial<CommandContext> = {}) =>
  fakeContext({
    options: { environment: "vps" },
    operand: FLAG,
    ...overrides,
  });

function command(name: "activate"): Command {
  const found = flagCommands[name];
  if (found === undefined) {
    throw new Error(`flag commands have no ${name} command`);
  }
  return found;
}

/** The production overlay of vps, declaring the flag off. */
function vpsOverlay() {
  return {
    environment: "vps",
    path: VPS_OVERLAY,
    text: "",
    features: { [FLAG]: false },
    production: true,
  };
}

beforeEach(() => {
  vi.mocked(flagRequires).mockResolvedValue([]);
  vi.mocked(readOverlay).mockResolvedValue(vpsOverlay());
  vi.mocked(activationProof).mockResolvedValue({ proof: PROOF, refused: [] });
  vi.mocked(withFlagOn).mockReturnValue("TURNED ON");
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
  vi.mocked(proofAudit).mockResolvedValue({ unproven: [], waived: [] });
  vi.mocked(unprovenLine).mockImplementation((u) => `line ${u.flag}`);
  vi.mocked(waivedLine).mockImplementation((w) => `waived ${w.flag}`);
  vi.mocked(isWaiverRefusal).mockReturnValue(false);
});

describe("flag activate in a production environment (ADR 0147)", () => {
  it("refuses an owner waiver, names it, ends with the live-run guidance, and leaves the overlay unchanged", async () => {
    vi.mocked(activationProof).mockResolvedValue({
      proof: undefined,
      refused: [WAIVER_REFUSAL],
    });
    vi.mocked(isWaiverRefusal).mockReturnValue(true);
    vi.mocked(noOutcomeMessage).mockReturnValue("NO LIVE RUN MESSAGE");
    const { context, err, writeFile } = vpsContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe(`${WAIVER_REFUSAL}. NO LIVE RUN MESSAGE\n`);
    expect(err()).not.toContain(CHART_ADVICE);
    expect(noOutcomeMessage).toHaveBeenCalledWith(FLAG, "vps", vpsOverlay());
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("keeps the chart-lock advice when a live run was refused for its charts, with or without a waiver beside it", async () => {
    vi.mocked(activationProof).mockResolvedValue({
      proof: undefined,
      refused: [CHART_REFUSAL, WAIVER_REFUSAL],
    });
    vi.mocked(isWaiverRefusal).mockImplementation(
      (reason) => reason === WAIVER_REFUSAL,
    );
    const { context, err, writeFile } = vpsContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toContain(CHART_ADVICE);
    expect(noOutcomeMessage).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("passes the production overlay to the wording module and throws what it returns when no live run is recorded", async () => {
    vi.mocked(activationProof).mockResolvedValue({
      proof: undefined,
      refused: [],
    });
    vi.mocked(noOutcomeMessage).mockReturnValue("NO LIVE RUN MESSAGE");
    const { context, err, writeFile } = vpsContext();
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(noOutcomeMessage).toHaveBeenCalledWith(FLAG, "vps", vpsOverlay());
    expect(err()).toBe("NO LIVE RUN MESSAGE\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("asks the proof to refuse waivers, because the overlay is production", async () => {
    vi.mocked(activationProof).mockResolvedValue({
      proof: undefined,
      refused: [],
    });
    await command("activate").run(vpsContext().context);
    expect(vi.mocked(activationProof).mock.calls[0]?.[4]).toBe(true);
  });

  it("still turns the flag on in vps from a live run", async () => {
    const { context, out } = vpsContext();
    expect(await command("activate").run(context)).toBe(0);
    expect(out()).toBe(`Flag ${FLAG} is on in vps; proof: ${PROOF.path}\n`);
  });
});

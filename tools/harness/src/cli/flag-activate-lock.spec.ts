// Docs: docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationProof,
  flagRequires,
  isWaiverRefusal,
  parseReleaseLock,
  readOverlay,
  proofAudit,
  unprovenLine,
  waivedLine,
  withFlagOn,
} from "../flag/index.js";
import type { Command } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { flagCommands } from "./flag-commands.js";
import type { CommandContext } from "../runtime/index.js";
import { fakeContext, fakeLedger } from "./command-support.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("./ledger-commands.js");
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  activationProof: vi.fn(),
  flagRequires: vi.fn(),
  isWaiverRefusal: vi.fn(),
  parseReleaseLock: vi.fn(),
  readOverlay: vi.fn(),
  proofAudit: vi.fn(),
  unprovenLine: vi.fn(),
  waivedLine: vi.fn(),
  withFlagOn: vi.fn(),
}));

const FLAG = "ingress-agentgateway";
const PROOF = {
  idea: "0001",
  path: "docs/ideas/0001-proof.md",
  source: "live-run" as const,
};
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
    production: false,
  };
}

beforeEach(() => {
  vi.mocked(flagRequires).mockResolvedValue([]);
  vi.mocked(readOverlay).mockResolvedValue(overlay(false));
  vi.mocked(activationProof).mockResolvedValue({ proof: PROOF, refused: [] });
  vi.mocked(withFlagOn).mockReturnValue("TURNED ON");
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
  vi.mocked(proofAudit).mockResolvedValue({ unproven: [], waived: [] });
  vi.mocked(unprovenLine).mockImplementation((u) => `line ${u.flag}`);
  vi.mocked(waivedLine).mockImplementation((w) => `waived ${w.flag}`);
  vi.mocked(isWaiverRefusal).mockReturnValue(false);
});

describe("flag activate compares a main-lock proof with the release chart lock", () => {
  const RELEASE = { cilium: { version: "1.0.0", digest: "sha256:a" } };
  const repoReleaseLock = "/repo/release.lock.json";

  function withLockFile(text: string | Error) {
    const run = flagContext({
      options: { environment: "local", "chart-lock": "release.lock.json" },
    });
    const readFile = vi.fn(() =>
      text instanceof Error ? Promise.reject(text) : Promise.resolve(text),
    );
    Object.assign(run.deps.fs, { readFile });
    return { ...run, readFile };
  }

  it("reads the release lock named by --chart-lock and judges the proof against it", async () => {
    vi.mocked(parseReleaseLock).mockReturnValue(RELEASE);
    const { context, readFile } = withLockFile("LOCK TEXT");
    expect(await command("activate").run(context)).toBe(0);
    expect(readFile).toHaveBeenCalledWith(repoReleaseLock);
    expect(parseReleaseLock).toHaveBeenCalledWith(
      "LOCK TEXT",
      "release.lock.json",
    );
    expect(activationProof).toHaveBeenCalledWith(
      expect.anything(),
      FLAG,
      "local",
      RELEASE,
      false,
    );
  });

  it("judges against no release lock, and reads no file, when --chart-lock is not given", async () => {
    const { context } = flagContext();
    expect(await command("activate").run(context)).toBe(0);
    expect(activationProof).toHaveBeenCalledWith(
      expect.anything(),
      FLAG,
      "local",
      undefined,
      false,
    );
    expect(parseReleaseLock).not.toHaveBeenCalled();
  });

  it("refuses when every matching live run was refused, naming each reason, leaving the overlay unchanged and saying to re-prove", async () => {
    vi.mocked(parseReleaseLock).mockReturnValue(RELEASE);
    vi.mocked(activationProof).mockResolvedValue({
      proof: undefined,
      refused: [
        "docs/ideas/0001-proof.md: its main-lock charts differ from the release lock: cilium (version 9.9.9, release lock 1.0.0)",
      ],
    });
    const { context, err, writeFile } = withLockFile("LOCK TEXT");
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe(
      `No live run of ${FLAG} in local counts, so ${OVERLAY} is unchanged: docs/ideas/0001-proof.md: its main-lock charts differ from the release lock: cilium (version 9.9.9, release lock 1.0.0). Re-prove it live on charts equal to the release chart lock, then record a new verification outcome with --lock and --charts.\n`,
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("refuses with a message that names the file when the release lock cannot be read", async () => {
    const { context, err, writeFile } = withLockFile(new Error("ENOENT"));
    expect(await command("activate").run(context)).toBe(FAILED);
    expect(err()).toBe(
      "Cannot read the release chart lock release.lock.json: ENOENT. Pass --chart-lock <platform-charts.lock.json> attached to the release.\n",
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("flag activate under a waiver that stands in for a refused live run", () => {
  const REASON =
    "docs/ideas/0001-proof.md: its main-lock charts differ from the release lock: cilium (version 9.9.9, release lock 1.0.0)";

  beforeEach(() => {
    vi.mocked(activationProof).mockResolvedValue({
      proof: { ...PROOF, idea: "0002", source: "owner-waiver" },
      refused: [REASON],
    });
    vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
  });

  it("warns with the refused live run's reasons, naming the charts, before saying the waiver is used", async () => {
    const { context, out } = flagContext();
    expect(await command("activate").run(context)).toBe(0);
    expect(out()).toBe(
      `warning: a live run of ${FLAG} in local was refused, ${REASON}\nFlag ${FLAG} is on in local under an owner waiver, not a live run; proof: ${PROOF.path}\n`,
    );
  });

  it("carries the refused reasons in the JSON output", async () => {
    const { context, out } = flagContext({ json: true });
    expect(await command("activate").run(context)).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      source: "owner-waiver",
      refused: [REASON],
    });
  });

  it("prints no warning and no refused field when a proof counts with nothing refused", async () => {
    vi.mocked(activationProof).mockResolvedValue({ proof: PROOF, refused: [] });
    const { context, out } = flagContext({ json: true });
    expect(await command("activate").run(context)).toBe(0);
    expect(JSON.parse(out())).not.toHaveProperty("refused");
  });
});

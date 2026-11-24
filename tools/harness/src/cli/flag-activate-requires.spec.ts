// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationProof,
  flagRequires,
  readOverlay,
  withFlagOn,
} from "../flag/index.js";
import type { Command } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { flagCommands } from "./flag-commands.js";
import { fakeContext, fakeLedger } from "./command-support.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("./ledger-commands.js");
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  activationProof: vi.fn(),
  flagRequires: vi.fn(),
  readOverlay: vi.fn(),
  withFlagOn: vi.fn(),
}));

const FLAG = "external-gateway-limits";
const OVERLAY = "infra/environments/local/environment.yaml";
const PROOF = {
  idea: "0001",
  path: "docs/ideas/0001-proof.md",
  source: "live-run" as const,
};
const FAILED = 1;

function command(): Command {
  const found = flagCommands["activate"];
  if (found === undefined) {
    throw new Error("flag commands have no activate command");
  }
  return found;
}

/** The flag as the operand, in the local environment, with the fake context's sinks. */
const flagContext = () =>
  fakeContext({ options: { environment: "local" }, operand: FLAG });

/** The local overlay with the given features. */
const overlayWith = (features: Record<string, boolean>) => ({
  environment: "local",
  path: OVERLAY,
  text: "",
  features,
});

beforeEach(() => {
  vi.mocked(flagRequires).mockResolvedValue([]);
  vi.mocked(activationProof).mockResolvedValue({ proof: PROOF, refused: [] });
  vi.mocked(withFlagOn).mockReturnValue("TURNED ON");
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
});

describe("flag activate refuses a flag whose required flag is off", () => {
  it("refuses, naming the missing flag, and leaves the overlay unchanged without reading a proof", async () => {
    vi.mocked(flagRequires).mockResolvedValue(["external-gateway"]);
    vi.mocked(readOverlay).mockResolvedValue(
      overlayWith({ [FLAG]: false, "external-gateway": false }),
    );
    const { context, err, writeFile } = flagContext();
    expect(await command().run(context)).toBe(FAILED);
    expect(err()).toContain(
      `${FLAG} requires external-gateway on in local, but it is off in ${OVERLAY}, so ${OVERLAY} is unchanged. Activate external-gateway in local first with \`harness flag activate\`, then rerun.`,
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(activationProof).not.toHaveBeenCalled();
  });

  it("names every required flag that is off, and a flag the overlay leaves out counts as off", async () => {
    vi.mocked(flagRequires).mockResolvedValue([
      "platform-shared-gateway",
      "service-listener-sets",
    ]);
    vi.mocked(readOverlay).mockResolvedValue(
      overlayWith({ [FLAG]: false, "platform-shared-gateway": false }),
    );
    const { context, err, writeFile } = flagContext();
    expect(await command().run(context)).toBe(FAILED);
    expect(err()).toContain(
      `${FLAG} requires platform-shared-gateway, service-listener-sets on in local, but they are off`,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("reads the requirements of the flag it activates from the flag manifest, at the repository root", async () => {
    vi.mocked(readOverlay).mockResolvedValue(overlayWith({ [FLAG]: false }));
    const { context } = flagContext();
    await command().run(context);
    expect(flagRequires).toHaveBeenCalledWith(expect.anything(), "/repo", FLAG);
  });
});

describe("flag activate turns a flag on once every flag it requires is on", () => {
  it("writes the overlay with the flag on when each required flag is on", async () => {
    vi.mocked(flagRequires).mockResolvedValue(["external-gateway"]);
    vi.mocked(readOverlay).mockResolvedValue(
      overlayWith({ [FLAG]: false, "external-gateway": true }),
    );
    const { context, writeFile } = flagContext();
    expect(await command().run(context)).toBe(0);
    expect(writeFile.mock.calls).toEqual([["/repo/" + OVERLAY, "TURNED ON"]]);
  });
});

// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock, FileSystem } from "../runtime/index.js";
import type { ProofSources } from "./app-windows.js";
import { proofAudit } from "./audit.js";
import { fakeFileSystem } from "./flag-support.js";
import { environments, readOverlay, type Overlay } from "./overlay.js";
import { findProof } from "./proof.js";

vi.mock("../idea/index.js");
vi.mock("./overlay.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./overlay.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));
vi.mock("./proof.js");

const BASE = "/repo";
const fs: FileSystem = fakeFileSystem();
const clock: Clock = { now: () => new Date(0), sleep: () => Promise.resolve() };

function overlayFor(
  environment: string,
  features: Record<string, boolean>,
): Overlay {
  return {
    environment,
    path: `infra/environments/${environment}/environment.yaml`,
    text: "",
    features,
  };
}

/** Sets which environments exist and what each overlay holds. */
function overlays(byEnvironment: Record<string, Overlay>): void {
  vi.mocked(environments).mockResolvedValue(Object.keys(byEnvironment));
  vi.mocked(readOverlay).mockImplementation((_fs, _root, environment) =>
    Promise.resolve(byEnvironment[environment] as Overlay),
  );
}

beforeEach(() => {
  vi.mocked(findProof).mockResolvedValue(undefined);
});

/** The sources the audit handed to findProof, read from its first call. */
function sourcesGiven(): ProofSources {
  const sources = vi.mocked(findProof).mock.calls[0]?.[3];
  if (sources === undefined) {
    throw new Error("findProof was not called with sources");
  }
  return sources;
}

describe("proofAudit classifies flags for the platform window", () => {
  it("calls every flag an overlay names a platform flag, so no window counts for it", async () => {
    overlays({
      local: overlayFor("local", { a: true }),
      vps: overlayFor("vps", { b: false }),
    });
    await proofAudit(fs, clock, BASE);
    const sources = sourcesGiven();
    expect(sources.isAppFlag("a")).toBe(false);
    expect(sources.isAppFlag("b")).toBe(false);
  });

  it("calls a flag no overlay names an app flag", async () => {
    overlays({ local: overlayFor("local", { a: true }) });
    await proofAudit(fs, clock, BASE);
    expect(sourcesGiven().isAppFlag("leads.new-checkout")).toBe(true);
  });
});

// Docs: docs/decisions/0077-live-proof-gates-activation-not-merge.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaRepository } from "../idea/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import {
  FlagError,
  environments,
  readOverlay,
  type Overlay,
} from "./overlay.js";
import { findProof } from "./proof.js";
import {
  proofAudit,
  unprovenFlags,
  unprovenLine,
  vpsLine,
  vpsUnprovenFlags,
  waivedLine,
} from "./audit.js";
import { fakeFileSystem } from "./flag-support.js";

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

/** An overlay with the given flags, read from `infra/environments/<environment>`. */
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

describe("unprovenFlags", () => {
  it("lists a flag that is on without a verification outcome", async () => {
    overlays({ local: overlayFor("local", { "ingress-agentgateway": true }) });
    expect(await unprovenFlags(fs, clock, BASE)).toEqual([
      {
        flag: "ingress-agentgateway",
        environment: "local",
        path: "infra/environments/local/environment.yaml",
      },
    ]);
  });

  it("passes a flag that is on with a proof", async () => {
    overlays({ local: overlayFor("local", { "ingress-agentgateway": true }) });
    vi.mocked(findProof).mockResolvedValue({
      idea: "0001",
      path: "docs/ideas/0001.md",
      source: "live-run",
    });
    expect(await unprovenFlags(fs, clock, BASE)).toEqual([]);
  });

  it("looks for proof only for flags that are on", async () => {
    overlays({
      local: overlayFor("local", { off: false, "on-flag": true }),
    });
    await unprovenFlags(fs, clock, BASE);
    expect(
      vi.mocked(findProof).mock.calls.map((call) => call.slice(1, 3)),
    ).toEqual([["on-flag", "local"]]);
  });

  it("checks every environment and lists each one's unproven flags in order", async () => {
    overlays({
      local: overlayFor("local", { a: true }),
      "managed-example": overlayFor("managed-example", { b: true }),
    });
    expect(await unprovenFlags(fs, clock, BASE)).toEqual([
      {
        flag: "a",
        environment: "local",
        path: "infra/environments/local/environment.yaml",
      },
      {
        flag: "b",
        environment: "managed-example",
        path: "infra/environments/managed-example/environment.yaml",
      },
    ]);
  });

  it("reads proof from a repository on the given file system, clock and base", async () => {
    overlays({});
    await unprovenFlags(fs, clock, BASE);
    expect(IdeaRepository).toHaveBeenCalledWith(fs, clock, BASE);
  });

  it("returns nothing and reads no overlay when there are no environments", async () => {
    overlays({});
    expect(await unprovenFlags(fs, clock, BASE)).toEqual([]);
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it("lets an unreadable overlay fail the audit rather than pass it", async () => {
    vi.mocked(environments).mockResolvedValue(["local"]);
    vi.mocked(readOverlay).mockRejectedValue(new FlagError("bad overlay"));
    await expect(unprovenFlags(fs, clock, BASE)).rejects.toThrow("bad overlay");
  });
});

describe("unprovenLine", () => {
  it("names the flag, environment and overlay, and the command that activates it", () => {
    expect(
      unprovenLine({
        flag: "ingress-agentgateway",
        environment: "local",
        path: "infra/environments/local/environment.yaml",
      }),
    ).toBe(
      "Flag ingress-agentgateway is on in local (infra/environments/local/environment.yaml) with no verification outcome. Set it back to false, then turn it on with `harness flag activate ingress-agentgateway --environment local` once a live run is recorded.",
    );
  });
});

describe("proofAudit", () => {
  it("lists a flag proven by an owner waiver apart from the unproven ones, naming the idea", async () => {
    overlays({
      local: overlayFor("local", { waived: true, bare: true, live: true }),
    });
    vi.mocked(findProof).mockImplementation((_repo, flag) =>
      Promise.resolve(
        flag === "bare"
          ? undefined
          : {
              idea: "0027",
              path: "docs/ideas/0027-proof.md",
              source: flag === "waived" ? "owner-waiver" : "live-run",
            },
      ),
    );
    expect(await proofAudit(fs, clock, BASE)).toEqual({
      unproven: [
        {
          flag: "bare",
          environment: "local",
          path: "infra/environments/local/environment.yaml",
        },
      ],
      waived: [
        {
          flag: "waived",
          environment: "local",
          path: "infra/environments/local/environment.yaml",
          idea: "0027",
          proof: "docs/ideas/0027-proof.md",
        },
      ],
    });
  });

  it("reports no waiver when every flag that is on has a live run", async () => {
    overlays({ local: overlayFor("local", { a: true }) });
    vi.mocked(findProof).mockResolvedValue({
      idea: "0001",
      path: "docs/ideas/0001.md",
      source: "live-run",
    });
    expect((await proofAudit(fs, clock, BASE)).waived).toEqual([]);
  });
});

describe("waivedLine", () => {
  it("says the flag rests on an owner waiver and not on a live run", () => {
    expect(
      waivedLine({
        flag: "automatic-revert",
        environment: "local",
        path: "infra/environments/local/environment.yaml",
        idea: "0044",
        proof: "docs/ideas/0044-proof.md",
      }),
    ).toBe(
      "Flag automatic-revert is on in local (infra/environments/local/environment.yaml) under an owner waiver, not a live run: docs/ideas/0044-proof.md.",
    );
  });
});

describe("vpsUnprovenFlags", () => {
  const VPS_OVERLAY = "infra/environments/vps/environment.yaml";

  it("lists a flag that is on in vps with no outcome", async () => {
    overlays({
      vps: overlayFor("vps", { openbao: true, "other-flag": false }),
    });
    expect(await vpsUnprovenFlags(fs, clock, BASE)).toEqual([
      { flag: "openbao", environment: "vps", path: VPS_OVERLAY },
    ]);
  });

  it("lists a vps flag that rests on an owner waiver, because a waiver never proves vps", async () => {
    overlays({ vps: overlayFor("vps", { waived: true }) });
    vi.mocked(findProof).mockResolvedValue({
      idea: "0044",
      path: "docs/ideas/0044-proof.md",
      source: "owner-waiver",
    });
    expect(await vpsUnprovenFlags(fs, clock, BASE)).toEqual([
      { flag: "waived", environment: "vps", path: VPS_OVERLAY },
    ]);
  });

  it("reports nothing when every true vps flag has a live-run outcome", async () => {
    overlays({ vps: overlayFor("vps", { a: true, b: true }) });
    vi.mocked(findProof).mockResolvedValue({
      idea: "0001",
      path: "docs/ideas/0001.md",
      source: "live-run",
    });
    expect(await vpsUnprovenFlags(fs, clock, BASE)).toEqual([]);
  });

  it("ignores flags on in other environments, and looks for proof only in vps", async () => {
    overlays({
      local: overlayFor("local", { a: true }),
      vps: overlayFor("vps", { b: false }),
    });
    expect(await vpsUnprovenFlags(fs, clock, BASE)).toEqual([]);
    expect(findProof).not.toHaveBeenCalled();
  });
});

describe("vpsLine", () => {
  it("names the flag and vps, and says a live run is needed before the flag goes on", () => {
    expect(
      vpsLine({
        flag: "openbao",
        environment: "vps",
        path: "infra/environments/vps/environment.yaml",
      }),
    ).toBe(
      "Flag openbao is on in vps (infra/environments/vps/environment.yaml) with no live-run outcome. Set it back to false, then turn it on with `harness flag activate openbao --environment vps` once a live run is recorded.",
    );
  });
});

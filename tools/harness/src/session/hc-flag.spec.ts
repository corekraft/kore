import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { HC_SESSIONS_FLAG, hcSessionsOn } from "./hc-flag.js";

vi.mock("../flag/index.js");

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
});

/** The local overlay with the given features, as the repository has it. */
function localOverlay(features: Record<string, boolean>): void {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue({
    environment: "local",
    path: "infra/environments/local/environment.yaml",
    text: "",
    features,
  });
}

describe("hcSessionsOn reads the hc-sessions flag from the local overlay", () => {
  it("is on only when the local overlay sets hc-sessions to true", async () => {
    localOverlay({ [HC_SESSIONS_FLAG]: true });

    await expect(hcSessionsOn(deps)).resolves.toBe(true);
  });

  it.each([
    ["sets it false", { [HC_SESSIONS_FLAG]: false }],
    ["does not name it", {}],
  ])("is off when the local overlay %s", async (_, features) => {
    localOverlay(features);

    await expect(hcSessionsOn(deps)).resolves.toBe(false);
  });

  it("is off, and reads no overlay, when the repository has no local environment", async () => {
    vi.mocked(environments).mockResolvedValue(["vps"]);

    await expect(hcSessionsOn(deps)).resolves.toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it("reads the environments and the local overlay under the root the deps name", async () => {
    localOverlay({ [HC_SESSIONS_FLAG]: true });

    await hcSessionsOn(deps);

    expect(environments).toHaveBeenCalledWith(deps.fs, "/repo");
    expect(readOverlay).toHaveBeenCalledWith(deps.fs, "/repo", "local");
  });

  it("names the flag hc-sessions, as the overlays declare it", () => {
    expect(HC_SESSIONS_FLAG).toBe("hc-sessions");
  });
});

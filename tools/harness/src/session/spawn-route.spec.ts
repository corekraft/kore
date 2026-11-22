import { beforeEach, describe, expect, it, vi } from "vitest";
import { contextOf, fakeDeps } from "./deps-support.js";
import { hcSessionsOn } from "./hc-flag.js";
import { spawn } from "./spawn.js";
import { spawnHc } from "./spawn-hc.js";
import { spawnRouted } from "./spawn-route.js";

vi.mock("./hc-flag.js");
vi.mock("./spawn.js");
vi.mock("./spawn-hc.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("spawnRouted starts a session on hc behind the hc-sessions flag", () => {
  it("runs the hc path, and not the herdr path, when the flag is on", async () => {
    const deps = fakeDeps();
    const context = contextOf(deps);
    vi.mocked(hcSessionsOn).mockResolvedValue(true);
    vi.mocked(spawnHc).mockResolvedValue(0);

    await expect(spawnRouted(context)).resolves.toBe(0);

    expect(hcSessionsOn).toHaveBeenCalledWith(deps);
    expect(spawnHc).toHaveBeenCalledExactlyOnceWith(context);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("runs the herdr path, unchanged, and starts no hc session when the flag is off", async () => {
    const deps = fakeDeps();
    const context = contextOf(deps);
    vi.mocked(hcSessionsOn).mockResolvedValue(false);
    vi.mocked(spawn).mockResolvedValue(0);

    await expect(spawnRouted(context)).resolves.toBe(0);

    expect(spawn).toHaveBeenCalledExactlyOnceWith(context);
    expect(spawnHc).not.toHaveBeenCalled();
  });
});

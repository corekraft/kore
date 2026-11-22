import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlagError } from "../flag/index.js";
import { contextOf, fakeDeps } from "./deps-support.js";
import { hcSessionsOn } from "./hc-flag.js";
import { spawn } from "./spawn.js";
import { spawnHc } from "./spawn-hc.js";
import { fail, FAILED } from "./output.js";
import { spawnRouted } from "./spawn-route.js";

vi.mock("./hc-flag.js");
vi.mock("./spawn.js");
vi.mock("./spawn-hc.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

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

describe("spawnRouted refuses an overlay it cannot read, and starts no session", () => {
  it("fails with the overlay's own message, and runs neither path, when the local overlay is malformed", async () => {
    const deps = fakeDeps();
    const context = contextOf(deps, { json: true });
    vi.mocked(hcSessionsOn).mockRejectedValue(
      new FlagError(
        "infra/environments/local/environment.yaml is not a JSON object.",
      ),
    );
    vi.mocked(fail).mockReturnValue(FAILED);

    await expect(spawnRouted(context)).resolves.toBe(FAILED);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      true,
      FAILED,
      "infra/environments/local/environment.yaml is not a JSON object.",
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnHc).not.toHaveBeenCalled();
  });

  it("rethrows an error that is not an overlay error", async () => {
    const deps = fakeDeps();
    vi.mocked(hcSessionsOn).mockRejectedValue(new Error("disk gone"));

    await expect(spawnRouted(contextOf(deps))).rejects.toThrow("disk gone");
    expect(fail).not.toHaveBeenCalled();
  });
});

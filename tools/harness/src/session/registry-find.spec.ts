import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainRoot } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";

vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));

const HC: SessionRecord = {
  version: 1,
  backend: "hc",
  terminal: "t7",
  name: "image-trust-writer",
  paneId: "t7",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue("/main");
});

/** Opens the registry the way a command does, over the fake deps. */
async function openWith(deps: FakeDeps): Promise<SessionRegistry> {
  return SessionRegistry.open(deps);
}
describe("SessionRegistry.findByTerminal", () => {
  it("returns the open record whose hc terminal is the id, and no other", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readdir.mockResolvedValue([
      "other-writer.json",
      "image-trust-writer.json",
    ]);
    deps.fs.readFile.mockImplementation((path: string) =>
      Promise.resolve(
        JSON.stringify(
          path.endsWith("other-writer.json")
            ? { ...HC, name: "other-writer", terminal: "t9" }
            : HC,
        ),
      ),
    );

    const registry = await openWith(deps);

    expect(await registry.findByTerminal("t7")).toStrictEqual(HC);
  });

  it("returns undefined when the only record naming the terminal is closed", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(true);
    deps.fs.readdir.mockResolvedValue(["image-trust-writer.json"]);
    deps.fs.readFile.mockResolvedValue(
      JSON.stringify({ ...HC, closedAt: "2026-01-02T03:06:00.000Z" }),
    );

    const registry = await openWith(deps);

    expect(await registry.findByTerminal("t7")).toBeUndefined();
  });

  it("returns undefined, without listing, when no state directory exists yet", async () => {
    const deps = fakeDeps();
    deps.fs.exists.mockResolvedValue(false);

    const registry = await openWith(deps);

    expect(await registry.findByTerminal("t7")).toBeUndefined();
    expect(deps.fs.readdir).not.toHaveBeenCalled();
  });
});

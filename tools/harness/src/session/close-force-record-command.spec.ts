import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { close } from "./close.js";
import {
  UNRESULTED,
  asRegistry,
  fakeRegistry,
  scene,
  type FakeRegistry,
} from "./close-support.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

// A plain object, not the class: a static method reference would be an unbound method.
const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));
vi.mock("./registry.js", () => ({ SessionRegistry: opener }));

/** A session the flip left with no terminal id: it never ran on hc, so there is no terminal to ask about. */
const NO_TERMINAL: SessionRecord = { ...UNRESULTED, backend: "hc" };

let registry: FakeRegistry;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("session close --force-record is the command that removes a record hc does not need", () => {
  it("removes a record with no terminal id, prints that, and exits 0 without a herdr or hc call", async () => {
    registry = fakeRegistry(NO_TERMINAL);
    opener.open.mockResolvedValue(asRegistry(registry));
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(0);

    expect(registry.remove).toHaveBeenCalledExactlyOnceWith(NO_TERMINAL.name);
    expect(s.runner.run).not.toHaveBeenCalled();
    expect(s.stdout).toHaveBeenCalledWith(
      expect.stringContaining(`Removed the record of ${NO_TERMINAL.name}`),
    );
  });

  it("is refused with exit 1 and keeps the record when hc cannot say whether its terminal is live", async () => {
    registry = fakeRegistry({ ...NO_TERMINAL, terminal: "t2" });
    opener.open.mockResolvedValue(asRegistry(registry));
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(1);

    expect(registry.remove).not.toHaveBeenCalled();
    expect(s.stderr).toHaveBeenCalledWith(
      expect.stringContaining(`terminal t2 could not be checked in hc`),
    );
  });

  it("names a record that does not exist and removes nothing", async () => {
    registry = fakeRegistry(undefined);
    opener.open.mockResolvedValue(asRegistry(registry));
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(1);

    expect(registry.remove).not.toHaveBeenCalled();
    expect(s.stderr).toHaveBeenCalledWith(
      expect.stringContaining("No session record named"),
    );
  });
});

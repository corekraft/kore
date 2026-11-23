import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { terminalsFor } from "./backend.js";
import { close } from "./close.js";
import { forceRecordClose } from "./close-force-record.js";
import {
  UNRESULTED,
  asRegistry,
  fakeRegistry,
  scene,
  type FakeRegistry,
} from "./close-support.js";
import { sessionNameError } from "./names.js";
import { fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

// A plain object, not the class: a static method reference would be an unbound method.
const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));
vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./backend.js", () => ({
  routeSession: vi.fn(),
  terminalsFor: vi.fn(),
}));
vi.mock("./close-force-record.js", () => ({
  forceRecordClose: vi.fn(),
}));
vi.mock("./close-hc-command.js", () => ({
  closeHcSession: vi.fn(),
}));
vi.mock("./names.js", () => ({
  sessionNameError: vi.fn(() => undefined),
}));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn((_deps, _json, code: number) => code),
}));

const TERMINALS = { kind: "hc" } as unknown as Terminals;

/** A session the flip left with no terminal id: it never ran on hc, so there is no terminal to ask about. */
const NO_TERMINAL: SessionRecord = { ...UNRESULTED, backend: "hc" };

let registry: FakeRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(terminalsFor).mockReturnValue(TERMINALS);
});

describe("session close --force-record is the command that removes a record hc does not need", () => {
  it("hands the name, the hc terminals and the registry to forceRecordClose, then prints the removal and exits 0", async () => {
    registry = fakeRegistry(NO_TERMINAL);
    opener.open.mockResolvedValue(asRegistry(registry));
    vi.mocked(forceRecordClose).mockResolvedValue({
      removed: NO_TERMINAL.name,
    });
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(0);

    expect(forceRecordClose).toHaveBeenCalledExactlyOnceWith(
      NO_TERMINAL.name,
      TERMINALS,
      asRegistry(registry),
    );
    expect(s.runner.run).not.toHaveBeenCalled();
    expect(s.stdout).toHaveBeenCalledWith(
      expect.stringContaining(`Removed the record of ${NO_TERMINAL.name}`),
    );
  });

  it("prints the removal as JSON under --json", async () => {
    registry = fakeRegistry(NO_TERMINAL);
    opener.open.mockResolvedValue(asRegistry(registry));
    vi.mocked(forceRecordClose).mockResolvedValue({
      removed: NO_TERMINAL.name,
    });
    const s = scene({ json: true, flags: { "force-record": true } });

    expect(await close(s.context)).toBe(0);

    expect(s.stdout).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ removed: NO_TERMINAL.name })}\n`,
    );
  });

  it("exits 1 through fail with the refusal forceRecordClose gave, and prints no removal", async () => {
    registry = fakeRegistry({ ...NO_TERMINAL, terminal: "t2" });
    opener.open.mockResolvedValue(asRegistry(registry));
    vi.mocked(forceRecordClose).mockResolvedValue({
      error: "terminal t2 could not be checked in hc",
    });
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(1);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      s.context.deps,
      false,
      1,
      "terminal t2 could not be checked in hc",
    );
    expect(s.stdout).not.toHaveBeenCalled();
  });
});

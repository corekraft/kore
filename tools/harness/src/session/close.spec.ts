import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { close } from "./close.js";
import { closeHcSession } from "./close-hc-command.js";
import {
  UNRESULTED,
  WITHOUT_WORKTREE,
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
vi.mock("./close-hc-command.js", () => ({
  closeHcSession: vi.fn(),
}));

let registry: FakeRegistry;

/** The registry the close reads, holding the one record given (or none). */
function registryOf(record: SessionRecord | undefined): void {
  registry = fakeRegistry(record);
  opener.open.mockResolvedValue(asRegistry(registry));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(closeHcSession).mockResolvedValue(0);
});

describe("session close refusals, touching nothing", () => {
  it("asks for a session name, opening no registry and running no command", async () => {
    const s = scene({ operand: undefined });

    expect(await close(s.context)).toBe(2);

    expect(opener.open).not.toHaveBeenCalled();
    expect(s.runner.run).not.toHaveBeenCalled();
    expect(closeHcSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid name with the name error, before the registry", async () => {
    const s = scene({ operand: "Not A Name" });

    expect(await close(s.context)).toBe(2);

    expect(opener.open).not.toHaveBeenCalled();
    expect(closeHcSession).not.toHaveBeenCalled();
  });

  it("refuses a name this tool did not create, closing no terminal", async () => {
    registryOf(undefined);
    const s = scene();

    expect(await close(s.context)).toBe(1);

    expect(closeHcSession).not.toHaveBeenCalled();
    expect(s.stderr).toHaveBeenCalledWith(
      expect.stringContaining("did not create a session named"),
    );
  });
});

describe("session close routes a record to hc, never to a pane", () => {
  it("hands an hc record with a terminal to closeHcSession, and runs no command", async () => {
    const hcRecord = {
      ...WITHOUT_WORKTREE,
      backend: "hc",
      terminal: "t7",
    } as unknown as SessionRecord;
    registryOf(hcRecord);
    const s = scene();

    expect(await close(s.context)).toBe(0);

    expect(closeHcSession).toHaveBeenCalledExactlyOnceWith(
      s.context,
      expect.anything(),
      expect.anything(),
      hcRecord,
    );
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("settles a start that was lost before it got a terminal, through closeHcSession", async () => {
    const lost = {
      ...UNRESULTED,
      backend: "hc",
      starting: true,
    } as unknown as SessionRecord;
    registryOf(lost);
    const s = scene();

    expect(await close(s.context)).toBe(0);

    expect(closeHcSession).toHaveBeenCalledExactlyOnceWith(
      s.context,
      expect.anything(),
      expect.anything(),
      lost,
    );
  });

  it("refuses a record with no terminal id, and names the command that removes it", async () => {
    registryOf({ ...UNRESULTED, backend: "hc" } as unknown as SessionRecord);
    const s = scene();

    expect(await close(s.context)).toBe(1);

    expect(closeHcSession).not.toHaveBeenCalled();
    expect(s.stderr).toHaveBeenCalledWith(
      expect.stringContaining("harness session close --force-record"),
    );
  });
});

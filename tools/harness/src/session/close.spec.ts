import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { routeSession, terminalsFor } from "./backend.js";
import { close } from "./close.js";
import { closeHcSession } from "./close-hc-command.js";
import { forceRecordClose } from "./close-force-record.js";
import {
  UNRESULTED,
  WITHOUT_WORKTREE,
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
vi.mock("./close-hc-command.js", () => ({
  closeHcSession: vi.fn(),
}));
vi.mock("./close-force-record.js", () => ({
  forceRecordClose: vi.fn(),
}));
vi.mock("./backend.js", () => ({
  routeSession: vi.fn(),
  terminalsFor: vi.fn(),
}));
vi.mock("./names.js", () => ({
  sessionNameError: vi.fn(() => undefined),
}));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn((_deps, _json, code: number) => code),
}));

const SPAWNING = { kind: "spawning" } as unknown as Terminals;
const ROUTED = { kind: "routed" } as unknown as Terminals;

let registry: FakeRegistry;

/** The registry the close reads, holding the one record given (or none). */
function registryOf(record: SessionRecord | undefined): void {
  registry = fakeRegistry(record);
  opener.open.mockResolvedValue(asRegistry(registry));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(closeHcSession).mockResolvedValue(0);
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(terminalsFor).mockReturnValue(SPAWNING);
  vi.mocked(routeSession).mockReturnValue({ terminals: ROUTED });
});

describe("session close refusals, touching nothing", () => {
  it("asks for a session name, opening no registry and closing no terminal", async () => {
    const s = scene({ operand: undefined });

    expect(await close(s.context)).toBe(2);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      s.context.deps,
      false,
      2,
      expect.stringContaining("Missing the session name"),
    );
    expect(opener.open).not.toHaveBeenCalled();
    expect(closeHcSession).not.toHaveBeenCalled();
  });

  it("rejects an invalid name with the name error, before the registry", async () => {
    vi.mocked(sessionNameError).mockReturnValue("The name is not valid.");
    const s = scene({ operand: "Not A Name" });

    expect(await close(s.context)).toBe(2);

    expect(sessionNameError).toHaveBeenCalledExactlyOnceWith("Not A Name");
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      s.context.deps,
      false,
      2,
      "The name is not valid.",
    );
    expect(opener.open).not.toHaveBeenCalled();
    expect(closeHcSession).not.toHaveBeenCalled();
  });

  it("refuses a name this tool did not create, closing no terminal", async () => {
    registryOf(undefined);
    const s = scene();

    expect(await close(s.context)).toBe(1);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      s.context.deps,
      false,
      1,
      expect.stringContaining("did not create a session named"),
    );
    expect(closeHcSession).not.toHaveBeenCalled();
  });
});

describe("session close routes a record to hc, never to a pane", () => {
  it("hands a routed hc record to closeHcSession with the routed terminals", async () => {
    const hcRecord = {
      ...WITHOUT_WORKTREE,
      backend: "hc",
      terminal: "t7",
    } as unknown as SessionRecord;
    registryOf(hcRecord);
    const s = scene();

    expect(await close(s.context)).toBe(0);

    expect(routeSession).toHaveBeenCalledExactlyOnceWith(hcRecord, SPAWNING);
    expect(closeHcSession).toHaveBeenCalledExactlyOnceWith(
      s.context,
      ROUTED,
      asRegistry(registry),
      hcRecord,
    );
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("settles a start that was lost before it got a terminal through closeHcSession, without routing it", async () => {
    const lost = {
      ...UNRESULTED,
      backend: "hc",
      starting: true,
    } as unknown as SessionRecord;
    registryOf(lost);
    const s = scene();

    expect(await close(s.context)).toBe(0);

    expect(routeSession).not.toHaveBeenCalled();
    expect(closeHcSession).toHaveBeenCalledExactlyOnceWith(
      s.context,
      SPAWNING,
      asRegistry(registry),
      lost,
    );
  });

  it("fails with routing's error and closes nothing when the record cannot be routed", async () => {
    vi.mocked(routeSession).mockReturnValue({
      error:
        "Session x has no terminal; run harness session close --force-record.",
    });
    registryOf({ ...UNRESULTED, backend: "hc" } as unknown as SessionRecord);
    const s = scene();

    expect(await close(s.context)).toBe(1);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      s.context.deps,
      false,
      1,
      "Session x has no terminal; run harness session close --force-record.",
    );
    expect(closeHcSession).not.toHaveBeenCalled();
  });
});

describe("session close --force-record removes the record file only", () => {
  it("reports the removal and opens no routing", async () => {
    vi.mocked(forceRecordClose).mockResolvedValue({ removed: "n" });
    registryOf(UNRESULTED);
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(0);

    expect(forceRecordClose).toHaveBeenCalledExactlyOnceWith(
      UNRESULTED.name,
      SPAWNING,
      asRegistry(registry),
    );
    expect(s.stdout).toHaveBeenCalledWith(
      expect.stringContaining(`Removed the record of ${UNRESULTED.name}`),
    );
    expect(routeSession).not.toHaveBeenCalled();
    expect(closeHcSession).not.toHaveBeenCalled();
  });

  it("fails with the refusal it was given and prints no removal", async () => {
    vi.mocked(forceRecordClose).mockResolvedValue({ error: "kept" });
    registryOf(UNRESULTED);
    const s = scene({ flags: { "force-record": true } });

    expect(await close(s.context)).toBe(1);

    expect(fail).toHaveBeenCalledExactlyOnceWith(
      s.context.deps,
      false,
      1,
      "kept",
    );
    expect(s.stdout).not.toHaveBeenCalled();
  });
});

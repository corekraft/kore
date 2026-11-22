import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError, type CliDeps } from "../runtime/index.js";
import {
  recordsOfTerminal,
  SessionRegistry,
  type SessionRecord,
} from "../session/index.js";
import type { Terminal, TerminalError, Terminals } from "../terminal/index.js";
import {
  hcTerminalId,
  sessionIdentity,
  sessionNotice,
} from "./guard-identity.js";

const openRegistry = vi.hoisted(() => vi.fn());

vi.mock("../session/index.js", () => ({
  SessionRegistry: { open: openRegistry },
  recordsOfTerminal: vi.fn(),
}));

/** The one assertion: the unit reads only the env, and the runner it hands its terminals. */
const asCliDeps = (parts: object) => parts as CliDeps;
/** The one assertion: a registry fake whose only member the unit reads is the lookup it passes the record to. */
const asRegistry = (parts: object) => parts as SessionRegistry;
/** The one assertion: a terminals fake with the one method the unit calls. */
const asTerminals = (parts: object) => parts as Terminals;

const RECORD: SessionRecord = {
  name: "hc-writer",
  paneId: "",
  backend: "hc",
  terminal: "t7",
  idea: "#1776",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const NO_IDEA: SessionRecord = {
  name: "hc-writer",
  paneId: "",
  backend: "hc",
  terminal: "t7",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const UNREADABLE = {
  file: "/main/.kore/state/sessions/hc-writer.json",
  reason:
    "is not a valid session record; delete it and spawn the session again.",
  terminal: "t7",
};
const named = (name: string): Terminal => ({
  id: "t7",
  name,
  state: "live",
  labels: {},
  cwd: "/work/tree",
});
const UNAVAILABLE: TerminalError = {
  error: { kind: "unavailable", message: "hc is not installed" },
};
const NOT_FOUND: TerminalError = {
  error: { kind: "not-found", message: "no terminal t7" },
};

const get = vi.fn<Terminals["get"]>();
const terminals = () => asTerminals({ get });
/** A fresh run's deps: the environment names the terminal, and each run asks once. */
const hcDeps = (env: Record<string, string> = { HC_TERMINAL_ID: "t7" }) =>
  asCliDeps({ env });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openRegistry).mockResolvedValue(asRegistry({}));
  vi.mocked(recordsOfTerminal).mockResolvedValue({
    record: RECORD,
    unreadable: [],
  });
  get.mockResolvedValue(named("hc-writer"));
});

describe("hcTerminalId", () => {
  it("reads HC_TERMINAL_ID from the environment, and names none when it is unset or empty", () => {
    expect(hcTerminalId(asCliDeps({ env: { HC_TERMINAL_ID: "t7" } }))).toBe(
      "t7",
    );
    expect(hcTerminalId(asCliDeps({ env: {} }))).toBeUndefined();
    expect(
      hcTerminalId(asCliDeps({ env: { HC_TERMINAL_ID: "" } })),
    ).toBeUndefined();
  });
});

describe("sessionIdentity outside an hc terminal", () => {
  it("names no identity, and reads no record or terminal", async () => {
    expect(
      await sessionIdentity(asCliDeps({ env: {} }), terminals()),
    ).toBeUndefined();
    expect(openRegistry).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("sessionIdentity in an hc terminal", () => {
  it("names the record's session, role and idea, checked, when hc names the terminal as the record does", async () => {
    expect(await sessionIdentity(hcDeps(), terminals())).toEqual({
      name: "hc-writer",
      role: "writer",
      idea: "#1776",
      checked: true,
    });
    expect(recordsOfTerminal).toHaveBeenCalledWith(expect.anything(), "t7");
    expect(get).toHaveBeenCalledWith("t7");
  });

  it("keeps the record's role, unchecked, when hc is unreachable", async () => {
    get.mockResolvedValue(UNAVAILABLE);

    expect(await sessionIdentity(hcDeps(), terminals())).toEqual({
      name: "hc-writer",
      role: "writer",
      idea: "#1776",
      checked: false,
    });
  });

  it("omits the idea when the record names none", async () => {
    vi.mocked(recordsOfTerminal).mockResolvedValue({
      record: NO_IDEA,
      unreadable: [],
    });

    expect(await sessionIdentity(hcDeps(), terminals())).toStrictEqual({
      name: "hc-writer",
      role: "writer",
      checked: true,
    });
  });

  it("names no identity when hc says the terminal does not exist", async () => {
    get.mockResolvedValue(NOT_FOUND);

    expect(await sessionIdentity(hcDeps(), terminals())).toBeUndefined();
  });

  it("names no identity when hc names the terminal for another session", async () => {
    get.mockResolvedValue(named("other-writer"));

    expect(await sessionIdentity(hcDeps(), terminals())).toBeUndefined();
  });

  it("names no identity, and asks hc nothing, when no record names the terminal", async () => {
    vi.mocked(recordsOfTerminal).mockResolvedValue({
      record: undefined,
      unreadable: [],
    });

    expect(await sessionIdentity(hcDeps(), terminals())).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it("names no identity when the main checkout cannot be found", async () => {
    vi.mocked(openRegistry).mockRejectedValue(
      new CommandError(
        "Cannot find the main checkout to keep session state in.",
      ),
    );

    expect(await sessionIdentity(hcDeps(), terminals())).toBeUndefined();
  });

  it("rethrows an error it does not expect", async () => {
    vi.mocked(openRegistry).mockRejectedValue(new Error("disk on fire"));

    await expect(sessionIdentity(hcDeps(), terminals())).rejects.toThrow(
      "disk on fire",
    );
  });

  it("reads the record once per run, so a guard and a recording hook share one lookup", async () => {
    const deps = hcDeps();
    await sessionIdentity(deps, terminals());
    await sessionIdentity(deps, terminals());

    expect(openRegistry).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("sessionNotice: the terminal's own record cannot be read", () => {
  it("names the unreadable file and the fix, and no identity, when it is the terminal's own record", async () => {
    vi.mocked(recordsOfTerminal).mockResolvedValue({
      record: undefined,
      unreadable: [UNREADABLE],
    });

    expect(await sessionIdentity(hcDeps(), terminals())).toBeUndefined();
    expect(await sessionNotice(hcDeps(), terminals())).toBe(
      "[guard] The session record /main/.kore/state/sessions/hc-writer.json for hc terminal t7 cannot be read (is not a valid session record; delete it and spawn the session again.), so the guard keeps the role from the call's payload. Fix it: remove that file, or spawn the session again with `harness session spawn`.",
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("names no notice when no unreadable file names the terminal", async () => {
    vi.mocked(recordsOfTerminal).mockResolvedValue({
      record: undefined,
      unreadable: [],
    });

    expect(await sessionNotice(hcDeps(), terminals())).toBeUndefined();
  });

  it("names no notice when the terminal's record reads", async () => {
    expect(await sessionNotice(hcDeps(), terminals())).toBeUndefined();
  });

  it("names no notice outside an hc terminal", async () => {
    expect(
      await sessionNotice(asCliDeps({ env: {} }), terminals()),
    ).toBeUndefined();
  });
});

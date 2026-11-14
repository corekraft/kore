import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LEDGER, Ledger, isName } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { recordEvent } from "./ledger-event.js";

vi.mock("node:path");
vi.mock("../ledger/index.js");
vi.mock("../runtime/index.js");

const MAIN = "/repo";
const LEDGER_PATH = "/repo/.kore/ledger.jsonl";
const NOW = new Date("2026-01-02T03:04:05.000Z");

/** The one assertion: a fake whose members the unit reads only through its mocked collaborators. */
const asCliDeps = (parts: object) => parts as CliDeps;

/** Fresh deps per test, because the unit caches the ledger root per deps object. */
function depsWith(env: Record<string, string | undefined> = {}) {
  return asCliDeps({
    env,
    clock: { now: () => NOW },
    fs: { tag: "fs" },
    ids: { tag: "ids" },
  });
}

/** A ledger listing that holds events with the given ids: the one cast is this fake's, the rest of the result is real. */
const listing = (...ids: string[]) =>
  ({ events: ids.map((id) => ({ id })) }) as Awaited<
    ReturnType<Ledger["list"]>
  >;

const recorded = () => vi.spyOn(Ledger.prototype, "record");
const listed = () => vi.spyOn(Ledger.prototype, "list");

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue(MAIN);
  vi.mocked(join).mockReturnValue(LEDGER_PATH);
  vi.mocked(isName).mockReturnValue(true);
  listed().mockResolvedValue(listing());
});

describe("recordEvent: the event it appends", () => {
  it("appends a claude event with the kind, session and clock time, to the ledger under the main root", async () => {
    await recordEvent(depsWith(), "session.start", { session_id: "s1" });

    expect(join).toHaveBeenCalledWith(MAIN, DEFAULT_LEDGER);
    expect(recorded()).toHaveBeenCalledWith({
      source: "claude",
      kind: "session.start",
      occurredAt: NOW.toISOString(),
      session: "s1",
    });
  });

  it("stamps the herdr pane when the environment names one, and omits it when empty", async () => {
    await recordEvent(depsWith({ HERDR_PANE_ID: "w3:p1" }), "session.start", {
      session_id: "s1",
    });
    await recordEvent(depsWith({ HERDR_PANE_ID: "" }), "session.start", {
      session_id: "s1",
    });

    expect(recorded().mock.calls[0]?.[0]).toMatchObject({ pane: "w3:p1" });
    expect(recorded().mock.calls[1]?.[0]).not.toHaveProperty("pane");
  });

  it("stamps the idea and agent only when the name is valid", async () => {
    vi.mocked(isName).mockImplementation((value) => value === "good");
    await recordEvent(
      depsWith({ KORE_IDEA: "good", KORE_AGENT: "bad" }),
      "session.start",
      { session_id: "s1" },
    );

    expect(recorded()).toHaveBeenCalledWith(
      expect.objectContaining({ idea: "good" }),
    );
    expect(recorded().mock.calls[0]?.[0]).not.toHaveProperty("agent");
  });

  it("records the tool name for a tool event, and not for any other kind", async () => {
    await recordEvent(depsWith(), "tool.start", {
      session_id: "s1",
      tool_name: "Bash",
    });
    await recordEvent(depsWith(), "session.start", {
      session_id: "s1",
      tool_name: "Bash",
    });

    expect(recorded().mock.calls[0]?.[0]).toMatchObject({ tool: "Bash" });
    expect(recorded().mock.calls[1]?.[0]).not.toHaveProperty("tool");
  });

  it("records the outcome when one is given, and lets extra fields override the defaults", async () => {
    await recordEvent(
      depsWith(),
      "tool.start",
      { session_id: "s1" },
      "failure",
      { occurredAt: "2025-05-05T00:00:00.000Z" },
    );

    expect(recorded()).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failure",
        occurredAt: "2025-05-05T00:00:00.000Z",
      }),
    );
  });
});

describe("recordEvent: when it records nothing", () => {
  it("records nothing and reads no ledger when the call carries no session id", async () => {
    await recordEvent(depsWith(), "session.start", {});
    await recordEvent(depsWith(), "session.start", { session_id: "" });

    expect(recorded()).not.toHaveBeenCalled();
    expect(mainRoot).not.toHaveBeenCalled();
  });

  it("records nothing when there is no main root to hold the ledger", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await recordEvent(depsWith(), "session.start", { session_id: "s1" });

    expect(recorded()).not.toHaveBeenCalled();
  });

  it("records nothing when the ledger already holds an event of that kind with the extra id", async () => {
    listed().mockResolvedValue(listing("dup"));

    await recordEvent(
      depsWith(),
      "session.start",
      { session_id: "s1" },
      undefined,
      {
        id: "dup",
      },
    );

    expect(listed()).toHaveBeenCalledWith({ kind: "session.start" });
    expect(recorded()).not.toHaveBeenCalled();
  });

  it("records an event whose extra id the ledger does not hold yet", async () => {
    listed().mockResolvedValue(listing("other"));

    await recordEvent(
      depsWith(),
      "session.start",
      { session_id: "s1" },
      undefined,
      {
        id: "new",
      },
    );

    expect(recorded()).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new" }),
    );
  });

  it("swallows a rejected append, because recording never changes a hook's verdict", async () => {
    recorded().mockRejectedValue(new Error("disk full"));

    await expect(
      recordEvent(depsWith(), "session.start", { session_id: "s1" }),
    ).resolves.toBeUndefined();
  });

  it("swallows a failed ledger root lookup for the same reason", async () => {
    vi.mocked(mainRoot).mockRejectedValue(new Error("no git"));

    await expect(
      recordEvent(depsWith(), "session.start", { session_id: "s1" }),
    ).resolves.toBeUndefined();
    expect(recorded()).not.toHaveBeenCalled();
  });
});

describe("recordEvent: the ledger root", () => {
  it("asks for the main root once per run, not once per event", async () => {
    const deps = depsWith();

    await recordEvent(deps, "session.start", { session_id: "s1" });
    await recordEvent(deps, "session.start", { session_id: "s2" });

    expect(mainRoot).toHaveBeenCalledTimes(1);
    expect(recorded()).toHaveBeenCalledTimes(2);
  });
});

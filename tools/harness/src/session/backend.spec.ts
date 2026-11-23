import { describe, expect, it, vi } from "vitest";
import {
  FakeTerminals,
  HcTerminals,
  terminalError,
} from "../terminal/index.js";
import { ProcessLineStream } from "../runtime/index.js";
import { fakeDeps } from "./deps-support.js";
import type { SessionRecord } from "./registry.js";
import { hcMessage, routeSession, terminalsFor } from "./backend.js";

vi.mock("../terminal/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../terminal/index.js")>()),
  HcTerminals: vi.fn(),
}));

const HERDR_RECORD: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

const HC_RECORD: SessionRecord = {
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

describe("routeSession sends a record to its hc terminals, and refuses one with no terminal id", () => {
  it("routes a record with a terminal id to the injected hc terminals", () => {
    const hc = new FakeTerminals();

    expect(routeSession(HC_RECORD, hc)).toStrictEqual({ terminals: hc });
  });

  it("refuses a record with no terminal id, naming the close that removes it, and never routes it", () => {
    const hc = new FakeTerminals();

    expect(routeSession(HERDR_RECORD, hc)).toStrictEqual({
      error:
        "Session image-trust-writer has no terminal id, so it is not on hc and nothing can be sent to or read from it. Run `harness session close --force-record image-trust-writer` to remove its record.",
    });
  });
});

describe("terminalsFor builds the hc adapter over the caller's runner and environment", () => {
  it("constructs HcTerminals over the injected runner and environment, and a process line stream to follow events", () => {
    const deps = fakeDeps();
    deps.env = { HC_TERMINAL_ID: "t7" };

    terminalsFor(deps);

    expect(HcTerminals).toHaveBeenCalledWith({
      runner: deps.runner,
      env: deps.env,
      lines: expect.any(ProcessLineStream),
    });
  });
});

describe("terminalsFor takes the line stream it is given, so a test can stand in for hc events", () => {
  it("builds the adapter over the line stream passed to it", () => {
    const deps = fakeDeps();
    const lines = { lines: vi.fn() };

    terminalsFor(deps, lines);

    expect(HcTerminals).toHaveBeenCalledWith({
      runner: deps.runner,
      env: deps.env,
      lines,
    });
  });
});

describe("hcMessage gives hc's message, with its hint in brackets when hc gives one", () => {
  it("adds the hint in brackets", () => {
    expect(
      hcMessage(
        terminalError(
          "not-found",
          "no terminal t2",
          "check the id with list()",
        ),
      ),
    ).toBe("no terminal t2 (check the id with list())");
  });

  it("gives the message alone when hc gives no hint", () => {
    expect(
      hcMessage(
        terminalError("timeout", "nothing has finished within 60000 ms"),
      ),
    ).toBe("nothing has finished within 60000 ms");
  });
});

const STARTING: SessionRecord = {
  version: 1,
  backend: "hc",
  name: "image-trust-writer",
  paneId: "",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
  starting: true,
};

describe("routeSession refuses a starting record that never got a terminal", () => {
  it("refuses it as blocked, not live, and never sends it to a terminal", () => {
    const hc = new FakeTerminals();

    expect(routeSession(STARTING, hc)).toStrictEqual({
      error:
        "Session image-trust-writer never started a terminal, so it is blocked, not live: it was lost before its start was recorded. Run session close image-trust-writer to clear it.",
    });
  });
});

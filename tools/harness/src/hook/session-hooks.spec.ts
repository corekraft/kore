// The session-hook barrel as a unit: it exposes exactly the four hooks that run
// around a session, each one the command its own module defines. The four
// modules are mocked, so no hook is built or run here.

import { describe, expect, it, vi } from "vitest";
import * as session from "./session-hooks.js";
import * as contextCommand from "./context-command.js";
import * as deltaCommand from "./delta-command.js";
import * as record from "./record.js";
import * as statusline from "./statusline.js";

vi.mock("./context-command.js");
vi.mock("./delta-command.js");
vi.mock("./record.js");
vi.mock("./statusline.js");

describe("session hooks barrel", () => {
  it("exposes exactly the context, delta, record and statusline hooks", () => {
    expect(Object.keys(session).sort()).toEqual([
      "context",
      "delta",
      "record",
      "statusline",
    ]);
  });

  it("exposes each hook as the command its own module defines", () => {
    expect(session.context).toBe(contextCommand.context);
    expect(session.delta).toBe(deltaCommand.delta);
    expect(session.record).toBe(record.record);
    expect(session.statusline).toBe(statusline.statusline);
  });
});

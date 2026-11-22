import { describe, expect, it } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import type { SessionRecord } from "./registry.js";
import { routeSession } from "./backend.js";

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

describe("routeSession sends a record to the backend it names", () => {
  it("routes a record with no backend to herdr, so every record written before the field keeps its path", () => {
    expect(routeSession(HERDR_RECORD, undefined)).toStrictEqual({
      backend: "herdr",
    });
  });

  it("routes an explicit herdr backend to herdr, even when an hc adapter is injected", () => {
    const hc = new FakeTerminals();

    expect(
      routeSession({ ...HERDR_RECORD, backend: "herdr" }, hc),
    ).toStrictEqual({ backend: "herdr" });
  });

  it("routes a backend hc record to the injected hc terminals", () => {
    const hc = new FakeTerminals();

    expect(routeSession(HC_RECORD, hc)).toStrictEqual({
      backend: "hc",
      terminals: hc,
    });
  });

  it("refuses an hc record when no hc terminals are available, with a hint, and never routes it to herdr", () => {
    expect(routeSession(HC_RECORD, undefined)).toStrictEqual({
      error:
        "Session image-trust-writer runs on hc, but hc is not available here, so it is not routed to herdr. Install the pinned hc (plan 16, step 1), then retry.",
    });
  });
});

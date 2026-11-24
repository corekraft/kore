import { describe, expect, it } from "vitest";
import { KINDS, parseEvent } from "./schema.js";
import { COMMAND_OWNED_KINDS } from "./schema-rollout.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const rolledOut = {
  source: "claude",
  kind: "platform.rolled-out",
  occurredAt: "2026-11-24T10:00:00.000Z",
  environment: "vps",
  tag: "v1.4.0",
  chartLock: DIGEST,
  imageLock: DIGEST,
  charts: `cert-manager@v1.19.1=${DIGEST},kore-config-delivery@0.3.0=${DIGEST}`,
};

describe("platform.rolled-out events", () => {
  it("is a kind the ledger knows and one only the rollout command writes", () => {
    expect(KINDS).toContain("platform.rolled-out");
    expect(COMMAND_OWNED_KINDS).toContain("platform.rolled-out");
  });

  it("holds the environment, tag, both lock digests and each chart's name, version and digest", () => {
    expect(parseEvent(rolledOut, "input")).toMatchObject({
      ok: true,
      event: rolledOut,
    });
  });

  it.each([
    ["environment", undefined],
    ["tag", undefined],
    ["chartLock", undefined],
    ["imageLock", undefined],
    ["charts", undefined],
    ["tag", "main"],
    ["tag", "v1.4"],
    ["chartLock", "abc"],
    ["imageLock", `sha256:${"G".repeat(64)}`],
    ["charts", "cert-manager"],
    ["charts", `cert-manager@v1=${DIGEST},`],
  ])("refuses a rollout with %s as %s", (field, value) => {
    expect(parseEvent({ ...rolledOut, [field]: value }, "input")).toMatchObject(
      { ok: false, field },
    );
  });

  it("refuses the rollout fields on any other kind", () => {
    expect(
      parseEvent({ ...rolledOut, kind: "session.start" }, "input"),
    ).toMatchObject({ ok: false });
  });
});

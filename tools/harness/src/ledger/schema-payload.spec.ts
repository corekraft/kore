import { describe, expect, it } from "vitest";
import { HOST_RULES } from "./schema-host.js";
import { PAYLOAD_RULES } from "./schema-payload.js";
import { ROLLOUT_RULES } from "./schema-rollout.js";

describe("the payload rules", () => {
  it("are the host-sample rules followed by the platform.rolled-out rules, so each payload field is an allowed ledger field", () => {
    expect(PAYLOAD_RULES).toEqual([...HOST_RULES, ...ROLLOUT_RULES]);
    expect(PAYLOAD_RULES.map((rule) => rule.field)).toEqual([
      "load",
      "memory",
      "swap",
      "sessions",
      "platform",
      "environment",
      "tag",
      "chartLock",
      "imageLock",
      "charts",
    ]);
  });
});

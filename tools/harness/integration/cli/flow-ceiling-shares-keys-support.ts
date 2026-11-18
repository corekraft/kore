import { expect } from "vitest";
import {
  AGENT_SHARE_LEVEL_KEYS,
  CEILING_SHARES_KEYS,
  COST_WAITING_KEYS,
  UNIT_SHARE_LEVEL_KEYS,
} from "./flow-report-keys-support.js";

type Shares = {
  agents: object;
  mergedChanges: object;
  ideas: object;
};

/**
 * Asserts the report's `costWaiting` and `costWaiting.ceilingShares` objects have exactly the
 * pinned keys, in order, for a report whose levels are not read (#1048).
 */
export function expectCeilingShareKeys(report: Record<string, unknown>): void {
  const cost = report["costWaiting"] as { ceilingShares: Shares };
  const shares = cost.ceilingShares;

  expect(Object.keys(cost)).toEqual(COST_WAITING_KEYS);
  expect(Object.keys(shares)).toEqual(CEILING_SHARES_KEYS);
  expect(Object.keys(shares.agents)).toEqual(AGENT_SHARE_LEVEL_KEYS);
  expect(Object.keys(shares.mergedChanges)).toEqual(UNIT_SHARE_LEVEL_KEYS);
  expect(Object.keys(shares.ideas)).toEqual(UNIT_SHARE_LEVEL_KEYS);
}

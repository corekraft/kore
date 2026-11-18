import { expect } from "vitest";
import { WRITING_KEYS } from "./flow-report-keys-support.js";

/** Asserts the report's `costWaiting.writing` object has exactly the pinned keys, in order (#1093). */
export function expectWritingKeys(report: Record<string, unknown>): void {
  const writing = (report["costWaiting"] as { writing: object }).writing;

  expect(Object.keys(writing)).toEqual(WRITING_KEYS);
}

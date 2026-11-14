// How many commit-hook test runs may share a host at once. Each run starts
// KORE_TEST_WORKERS vitest workers (two by default), so the host admits as many
// runs as its idle cores cover: (cores - one-minute load average) / workers,
// capped by cores / workers and never below one, so a commit always gets a turn.
// `export KORE_TEST_SLOTS=<n>` (a positive whole number) fixes the size.
// Docs: docs/guides/contributor.md (Commit hooks)

import { availableParallelism, loadavg } from "node:os";
import { testWorkers } from "./test-workers.mjs";

/** The number of test runs the host admits now. */
export function slotCount({
  env = process.env,
  cores = availableParallelism(),
  load = loadavg()[0] ?? 0,
} = {}) {
  const override = env.KORE_TEST_SLOTS;
  if (override !== undefined && override !== "") {
    if (!/^[1-9][0-9]*$/.test(override)) {
      throw new Error(
        `KORE_TEST_SLOTS must be a positive whole number, got "${override}"; unset it to size the slots from the cores and load`,
      );
    }
    return Number(override);
  }
  const workers = testWorkers(env);
  return Math.max(
    1,
    Math.min(Math.floor(cores / workers), Math.floor((cores - load) / workers)),
  );
}

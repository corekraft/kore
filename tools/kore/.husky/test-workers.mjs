// How many vitest workers a unit run may start. Both packages' vitest configs
// read it, so `test:unit`, `npm test`, `mise run test` and the commit hook share
// one cap instead of starting a worker per core beside a live cluster.
// Override with KORE_TEST_WORKERS (a positive whole number); CI sets its own.
// Docs: docs/guides/contributor.md (Commit hooks)

import { availableParallelism } from "node:os";

/** A quarter of the host's CPUs, never fewer than two. */
export function testWorkers(env = process.env, cpus = availableParallelism()) {
  const override = env.KORE_TEST_WORKERS;
  if (override === undefined) {
    return Math.max(2, Math.floor(cpus / 4));
  }
  if (!/^[1-9][0-9]*$/.test(override)) {
    throw new Error(
      `KORE_TEST_WORKERS must be a positive whole number, got "${override}"; unset it to use a quarter of the CPUs`,
    );
  }
  return Number(override);
}

// How many vitest workers a unit run may start. Both packages' vitest configs
// read it, so `test:unit`, `npm test`, `mise run test` and the commit hook share
// one cap instead of starting a worker per core beside a live cluster.
// Two workers by default, on any host; a shell `export KORE_TEST_WORKERS=<n>`
// (a positive whole number) overrides it, and CI sets its own.
// Docs: docs/guides/contributor.md (Commit hooks)

const DEFAULT_WORKERS = 2;

/** Two workers unless KORE_TEST_WORKERS says otherwise. */
export function testWorkers(env = process.env) {
  const override = env.KORE_TEST_WORKERS;
  if (override === undefined) {
    return DEFAULT_WORKERS;
  }
  if (!/^[1-9][0-9]*$/.test(override)) {
    throw new Error(
      `KORE_TEST_WORKERS must be a positive whole number, got "${override}"; unset it to use the default of two`,
    );
  }
  return Number(override);
}

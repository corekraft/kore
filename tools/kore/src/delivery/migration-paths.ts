// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The app-root directory that holds an application's migrations. It is fixed for v1 by convention
// (the issue's record of the owner's answer): a per-app path can come later as an optional key.
export const MIGRATIONS_PATH = "migrations/";

// The paths a data contract may touch besides the migrations: tests, never docs or source.
export const TEST_PATHS = [
  /(^|\/)(tests?|__tests__)\//,
  /\.(spec|test)\.[cm]?[jt]sx?$/,
];

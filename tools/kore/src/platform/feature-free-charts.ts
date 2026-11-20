// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md

/**
 * The charts whose closed schemas name no feature flag and whose templates
 * read none (the delivery charts, the portal and the PostgreSQL API): kore passes
 * them no `features.*` value on either path, since Helm refuses a key the schema
 * does not declare.
 */
export const featureFreeCharts: ReadonlySet<string> = new Set([
  "kore-config-delivery",
  "kore-golden-path-delivery",
  "kore-platform-backstage",
  "kore-postgresql-api",
]);

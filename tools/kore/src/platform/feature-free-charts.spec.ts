// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md
import { expect, test } from "vitest";
import { featureFreeCharts } from "./feature-free-charts.js";

test("only the charts whose schemas name no feature flag take none: the delivery charts, the portal and the PostgreSQL API", () => {
  expect([...featureFreeCharts].sort()).toEqual([
    "kore-config-delivery",
    "kore-golden-path-delivery",
    "kore-platform-backstage",
    "kore-postgresql-api",
  ]);
});

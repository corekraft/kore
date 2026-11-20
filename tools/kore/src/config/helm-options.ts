import type { Component } from "./types.js";

// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md

/**
 * Whether a release sets helm.takeOwnership without a reason that says what it
 * adopts. Take-ownership lets Helm claim objects an earlier apply created
 * (ADR 0137), so the catalog must say which ones and why.
 */
export function takeOwnershipWithoutReason(component: Component): boolean {
  return (
    component.helm?.takeOwnership === true && !component.helm.reason?.trim()
  );
}

import type { LoadRoute } from "./route-load.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set

/**
 * The routes of a delivered golden-path service at its own Gateway: the static
 * frontend's page and health route, and the BFF behind the `/api` prefix. The
 * unmodified kotlin-bff template maps no controller, so `/api` answers 404
 * from the BFF; a tenant's BFF with a controller there answers otherwise, and
 * its numbers are not this baseline.
 */
export const goldenPathRoutes: readonly LoadRoute[] = [
  { path: "/", status: 200 },
  { path: "/healthz", status: 200 },
  { path: "/api", status: 404 },
];

/** Its own set with its own name, so old and new results are never compared across routes. */
export const goldenPathRouteSet = {
  name: "golden-path",
  routes: goldenPathRoutes,
} as const;

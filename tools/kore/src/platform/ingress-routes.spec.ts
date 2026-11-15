import { expect, test } from "vitest";
import { ingressRoutes } from "./ingress-routes.js";

test("the load exercises the four reference routes, the protected one expecting a denial", () => {
  expect(ingressRoutes).toEqual([
    { path: "/livez", status: 200 },
    { path: "/readyz", status: 200 },
    { path: "/api", status: 200 },
    { path: "/api/protected", status: 403 },
  ]);
});

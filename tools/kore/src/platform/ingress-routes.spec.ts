import { expect, test } from "vitest";
import { ingressRoutes } from "./ingress-routes.js";

test("the one route that must be denied is the protected one, so the authorizer path is exercised", () => {
  expect(
    ingressRoutes.filter((route) => route.status !== 200).map((r) => r.path),
  ).toEqual(["/api/protected"]);
});

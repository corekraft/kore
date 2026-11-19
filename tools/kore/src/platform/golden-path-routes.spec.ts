import { expect, test } from "vitest";
import { goldenPathRouteSet, goldenPathRoutes } from "./golden-path-routes.js";

test("the golden-path route set is named, so its results are never read against the reference routes", () => {
  expect(goldenPathRouteSet).toEqual({
    name: "golden-path",
    routes: goldenPathRoutes,
  });
});

test("the golden-path routes are the frontend's page and health route and the BFF's /api prefix, each with its expected status", () => {
  expect(goldenPathRoutes).toEqual([
    { path: "/", status: 200 },
    { path: "/healthz", status: 200 },
    { path: "/api", status: 404 },
  ]);
});

test("the golden-path routes share no path with the reference routes", () => {
  const reference = ["/livez", "/readyz", "/api/protected"];
  expect(
    goldenPathRoutes.filter((route) => reference.includes(route.path)),
  ).toEqual([]);
});

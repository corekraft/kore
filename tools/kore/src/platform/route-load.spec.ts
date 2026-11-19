import { expect, test } from "vitest";
import { countRound, loadArgs } from "./route-load.js";

const target = {
  hostname: "kore.local",
  port: 8443,
  caRoot: "/ca",
  requestsPerRoute: 50,
  concurrency: 4,
};
const route = { path: "/api", status: 404 };

test("loadArgs builds one parallel curl call to the route, verifying the local CA", () => {
  expect(loadArgs(target, "/api")).toEqual([
    "--silent",
    "--show-error",
    "--output",
    "/dev/null",
    "--write-out",
    "%{http_code}\\n",
    "--connect-timeout",
    "5",
    "--max-time",
    "60",
    "--cacert",
    "/ca/rootCA.pem",
    "--resolve",
    "kore.local:8443:127.0.0.1",
    "--parallel",
    "--parallel-max",
    "4",
    "https://kore.local:8443/api#[1-50]",
  ]);
});

test("loadArgs never disables certificate verification", () => {
  expect(loadArgs(target, "/api")).not.toContain("--insecure");
});

test("countRound returns the number of requests that answered the expected status", () => {
  expect(countRound(route, "404\n404\n404\n", 3)).toBe(3);
});

test("countRound fails naming the route when a request answered another status", () => {
  expect(() => countRound(route, "404\n503\n404\n", 3)).toThrow(
    "route /api answered 503 for 1 of 3 requests, expected 404",
  );
});

test("countRound fails when fewer requests completed than were sent", () => {
  expect(() => countRound(route, "404\n404\n", 3)).toThrow(
    "route /api completed 2 of 3 requests",
  );
});

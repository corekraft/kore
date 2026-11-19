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

const goldenTarget = {
  hostname: "golden-path-example.platform.kore.local",
  port: 443,
  caRoot: "/ca",
  requestsPerRoute: 50,
  concurrency: 4,
};

test("a published hostname is reached with --connect-to, never --resolve, since curl --resolve takes only a numerical address", () => {
  const args = loadArgs(
    { ...goldenTarget, address: "lb.kore.internal" },
    "/healthz",
  );

  expect(args).toStrictEqual([
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
    "--connect-to",
    "golden-path-example.platform.kore.local:443:lb.kore.internal:443",
    "--parallel",
    "--parallel-max",
    "4",
    "https://golden-path-example.platform.kore.local:443/healthz#[1-50]",
  ]);
});

test("a published IP keeps --resolve, pointing the hostname at that address and port", () => {
  const args = loadArgs({ ...goldenTarget, address: "10.0.0.5" }, "/healthz");

  expect(args).toStrictEqual([
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
    "golden-path-example.platform.kore.local:443:10.0.0.5",
    "--parallel",
    "--parallel-max",
    "4",
    "https://golden-path-example.platform.kore.local:443/healthz#[1-50]",
  ]);
});

test("with no published address the hostname resolves to loopback, as the shared Gateway needs", () => {
  const args = loadArgs(goldenTarget, "/healthz");

  expect(args).toContain(
    "golden-path-example.platform.kore.local:443:127.0.0.1",
  );
  expect(args).not.toContain("--connect-to");
});

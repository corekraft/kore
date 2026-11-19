import { expect, test } from "vitest";
import { loadArgs } from "./route-load.js";

const target = {
  hostname: "golden-path-example.platform.kore.local",
  port: 443,
  caRoot: "/ca",
  requestsPerRoute: 50,
  concurrency: 4,
};

test("a published hostname is reached with --connect-to, never --resolve, since curl --resolve takes only a numerical address", () => {
  const args = loadArgs({ ...target, address: "lb.kore.internal" }, "/healthz");

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
  const args = loadArgs({ ...target, address: "10.0.0.5" }, "/healthz");

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
  const args = loadArgs(target, "/healthz");

  expect(args).toContain(
    "golden-path-example.platform.kore.local:443:127.0.0.1",
  );
  expect(args).not.toContain("--connect-to");
});

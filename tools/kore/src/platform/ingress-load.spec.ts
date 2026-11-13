import assert from "node:assert/strict";
import { test } from "vitest";
import {
  FakeLoad,
  fixture,
  sampleResponses,
} from "./ingress-measurement.fixtures.js";

test("no curl call uses a method or body flag, so the load is read-only GETs", async () => {
  const { load, measurement } = fixture(sampleResponses(2));
  await measurement.measure();
  const curls = (load as FakeLoad).calls;
  assert.ok(curls.length > 0);
  const writing = [
    "-X",
    "--request",
    "-d",
    "--form",
    "-F",
    "--upload-file",
    "-T",
    "--json",
    "--head",
    "-I",
  ];
  for (const { args } of curls) {
    for (const arg of args) {
      assert.ok(!writing.includes(arg), `curl used ${arg}`);
      assert.ok(!arg.startsWith("--data"), `curl used ${arg}`);
    }
  }
});

test("the load verifies the local CA, never disables certificate checks, and is time bounded", async () => {
  const { load, measurement } = fixture(sampleResponses(2));
  await measurement.measure();
  const curls = (load as FakeLoad).calls;
  assert.ok(curls.length > 0);
  for (const { args } of curls) {
    assert.ok(args.includes("--cacert"));
    assert.ok(args.includes("/ca/rootCA.pem"));
    assert.ok(!args.includes("--insecure"));
    assert.ok(!args.includes("-k"));
    assert.ok(args.includes("kore.local:8443:127.0.0.1"));
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    assert.equal(after("--connect-timeout"), "5");
    assert.equal(after("--max-time"), "60");
    assert.equal(after("--write-out"), "%{http_code}\\n");
  }
});

test("requests carry the route's exact path and no query string", async () => {
  const { load, measurement } = fixture(sampleResponses(2));
  await measurement.measure();
  const urls = (load as FakeLoad).calls.map(({ args }) => String(args.at(-1)));
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.ok(!url.includes("?"), url);
    assert.match(url, /^https:\/\/kore\.local:8443\/[a-z/]+#\[1-50\]$/);
  }
});

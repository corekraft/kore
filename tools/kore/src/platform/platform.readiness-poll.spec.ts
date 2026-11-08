import assert from "node:assert/strict";
import { test } from "vitest";
import { pollUntil } from "./readiness-poll.js";

test("a Forbidden error fails at once without polling", async () => {
  let probes = 0;
  await assert.rejects(
    pollUntil("10s", async () => {
      probes += 1;
      throw new Error('secrets "x" is forbidden: Forbidden');
    }),
    /Forbidden/,
  );
  assert.equal(probes, 1);
});

test("malformed JSON fails at once without polling", async () => {
  let probes = 0;
  await assert.rejects(
    pollUntil("10s", async () => {
      probes += 1;
      JSON.parse("not json");
      return undefined;
    }),
    SyntaxError,
  );
  assert.equal(probes, 1);
});

test("a NotFound error is retried until the resource appears", async () => {
  let probes = 0;
  await pollUntil("10s", async () => {
    probes += 1;
    if (probes < 2) {
      throw new Error('Error from server (NotFound): gateways "x" not found');
    }
    return undefined;
  });
  assert.equal(probes, 2);
});

test("a missing resource type is retried", async () => {
  let probes = 0;
  await pollUntil("10s", async () => {
    probes += 1;
    if (probes < 2) {
      throw new Error('error: the server doesn\'t have a resource type "x"');
    }
    return undefined;
  });
  assert.equal(probes, 2);
});

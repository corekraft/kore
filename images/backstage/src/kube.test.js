import assert from "node:assert/strict";
import { test } from "node:test";
import { listPlatformObjects, PlatformReadError } from "./kube.js";

const base = "https://kubernetes.default.svc/apis/platform.kore.dev/v1alpha1";

function deps(responses) {
  const calls = [];
  return {
    calls,
    readToken: async () => "sa-token\n",
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers, method: init.method });
      const body = responses[url];
      return body === undefined
        ? { ok: false, status: 403, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => body };
    },
  };
}

test("organizations and services are read with GET and the pod's token only", async () => {
  const d = deps({
    [`${base}/organizations`]: { items: [{ metadata: { name: "platform" } }] },
    [`${base}/services`]: { items: [{ metadata: { name: "shop" } }] },
  });
  const out = await listPlatformObjects(d);
  assert.deepEqual(out, {
    organizations: [{ metadata: { name: "platform" } }],
    services: [{ metadata: { name: "shop" } }],
  });
  assert.deepEqual(
    d.calls.map((c) => c.method),
    ["GET", "GET"],
  );
  assert.equal(d.calls[0].headers.Authorization, "Bearer sa-token");
});

test("a refused list names the resource and status instead of returning empty", async () => {
  await assert.rejects(
    () => listPlatformObjects(deps({})),
    /organizations.*403/,
  );
});

test("a refused list is a PlatformReadError", async () => {
  await assert.rejects(() => listPlatformObjects(deps({})), PlatformReadError);
});

test("a network failure or a missing token file is a PlatformReadError naming the cause", async () => {
  const fetchFails = {
    readToken: async () => "t",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  };
  await assert.rejects(
    () => listPlatformObjects(fetchFails),
    (e) => e instanceof PlatformReadError && /fetch failed/.test(e.message),
  );
  const noToken = {
    fetch: async () => ({}),
    readToken: async () => {
      throw new Error("ENOENT");
    },
  };
  await assert.rejects(
    () => listPlatformObjects(noToken),
    (e) => e instanceof PlatformReadError && /ENOENT/.test(e.message),
  );
});

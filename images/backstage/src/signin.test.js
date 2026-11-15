import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSignIn } from "./signin.js";

function context() {
  const issued = [];
  return {
    issued,
    issueToken: async (request) => {
      issued.push(request);
      return { token: "t" };
    },
  };
}
const info = (claims) => ({ result: { fullProfile: { userinfo: claims } } });

test("the Keycloak group paths become group entity refs in the token", async () => {
  const c = context();
  const out = await resolveSignIn(
    info({
      preferred_username: "ada",
      groups: ["/platform/platform-operators", "/platform"],
    }),
    c,
  );
  assert.deepEqual(out, { token: "t" });
  assert.deepEqual(c.issued, [
    {
      claims: {
        sub: "user:default/ada",
        ent: [
          "user:default/ada",
          "group:default/platform-operators",
          "group:default/platform",
        ],
      },
    },
  ]);
});

test("a user with no groups claim is signed in with only their own ref", async () => {
  const c = context();
  await resolveSignIn(info({ preferred_username: "ada" }), c);
  assert.deepEqual(c.issued[0].claims.ent, ["user:default/ada"]);
});

test("a token with no username is refused", async () => {
  await assert.rejects(
    () => resolveSignIn(info({}), context()),
    /preferred_username/,
  );
});

test("a username that is not a valid entity name is refused, not rewritten", async () => {
  await assert.rejects(
    () => resolveSignIn(info({ preferred_username: "a b" }), context()),
    /not a valid/,
  );
});

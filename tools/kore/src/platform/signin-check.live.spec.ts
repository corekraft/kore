import assert from "node:assert/strict";
import test from "node:test";
import { live, setup } from "./identity-live.js";
import { checkSignIn } from "./signin-check.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Live and opt-in; see identity-live.ts. Run: npm run test:live:signin
// Creates a throwaway operators-group user for the run and removes it, on success and failure.
// Prints the assertions as one JSON line, which holds no credential or alert address.

test(
  "a sign-in through Keycloak reaches Backstage, and a request with no sign-in is refused",
  live,
  async () => {
    const { repository, runner } = await setup();
    const result = await checkSignIn(repository, runner);
    console.log(JSON.stringify(result));
    assert.deepEqual(
      result.assertions.map((assertion) => assertion.name),
      ["signed-in call succeeds", "request with no sign-in is refused"],
    );
    for (const assertion of result.assertions) {
      assert.equal(assertion.ok, true, assertion.name);
    }
  },
);

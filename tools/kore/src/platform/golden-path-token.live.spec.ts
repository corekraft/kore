import assert from "node:assert/strict";
import test from "node:test";
import { gatewayEntryPort } from "../config/index.js";
import {
  checkSessionTokens,
  goldenPathSignInTarget,
} from "../testing/index.js";
import { goldenPathReach } from "./golden-path-reach.live.js";
import { live, setup } from "./identity-live.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: infra/plans/15-next-horizon.md (Step 7, the browser token test)
// Live and opt-in; see identity-live.ts. Run: npm run test:live:golden-path-token
// (in tools/kore), with KORE_RUN_LIVE=1 and KORE_SIGNIN_SERVICE=<service>, the
// delivered Service's name, one DNS label, such as golden-path-example.
// The preconditions are the golden-path sign-in check's (golden-path-signin.live.spec.ts):
// the Service delivered with golden-path-signin on, and on the shared Gateway.
// It reads the Service and its route first, changes nothing, and refuses before it
// creates a user. The throwaway user is created in the target's realm and removed,
// on success and on failure. The output is one JSON line with the seven assertions,
// and the session cookies' names and attributes. It holds no cookie value, token or
// page text.

const service = process.env.KORE_SIGNIN_SERVICE;

test(
  "after a sign-in to a golden-path Service, no token is readable by script or in a URL, and its session cookies are host-only, HttpOnly, Secure and SameSite",
  live,
  async () => {
    if (service === undefined || service === "") {
      throw new Error(
        "set KORE_SIGNIN_SERVICE to the delivered golden-path Service's name, such as golden-path-example",
      );
    }
    const { repository, runner } = await setup();
    const target = goldenPathSignInTarget(repository.environment, service);
    const { kubeContext, name, gateway } = repository.environment;
    const reach = await goldenPathReach(runner, {
      kubeContext,
      namespace: `${service}--${name}`,
      service,
      sharedGateway: { ...gateway, port: gatewayEntryPort },
    });
    assert.equal(
      reach.via,
      "shared",
      `the golden-path Service ${service} has its own Gateway, so its sign-in cannot be checked on the shared Gateway; deliver it with platform-shared-gateway on`,
    );
    const result = await checkSessionTokens(repository, runner, target);
    console.log(JSON.stringify(result));
    assert.deepEqual(
      result.assertions.map((assertion) => assertion.name),
      [
        "signed-in call succeeds",
        "no token in localStorage",
        "no token in sessionStorage",
        "no token in non-HttpOnly cookies",
        "no token in response bodies visible to the page",
        "no token in URLs or redirects",
        "every session cookie is host-only, HttpOnly, Secure and SameSite",
      ],
    );
    for (const assertion of result.assertions) {
      assert.equal(assertion.ok, true, assertion.name);
    }
  },
);

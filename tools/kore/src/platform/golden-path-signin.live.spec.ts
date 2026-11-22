import assert from "node:assert/strict";
import test from "node:test";
import { gatewayEntryPort } from "../config/index.js";
import { checkSignIn, goldenPathSignInTarget } from "../testing/index.js";
import { goldenPathReach } from "./golden-path-reach.live.js";
import { live, setup } from "./identity-live.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
// Live and opt-in; see identity-live.ts. Run: npm run test:live:golden-path-signin
// (in tools/kore), with KORE_RUN_LIVE=1 and KORE_SIGNIN_SERVICE=<service>, the
// delivered Service's name, one DNS label, such as golden-path-example.
// What it needs, all of it on the local platform:
// - the Service delivered with golden-path-signin on, so its workload renders its
//   Keycloak client (golden-path-<service>) and the BFF gets its sign-in variables;
// - platform-shared-gateway on, so the Service's route is on the shared Gateway
//   (the check refuses a Service with its own Gateway, by name);
// - an image and route that carry /api/whoami and the /oauth2 routing of the
//   golden-path sign-in (issue #1760); without them the check fails by name.
// It reads the Service and its route first, changes nothing, and refuses before it
// creates a user. The throwaway user is created in the platform realm and removed,
// on success and on failure. The output is one JSON line with the two assertions,
// which holds no credential, cookie or page body.

const service = process.env.KORE_SIGNIN_SERVICE;

test(
  "a sign-in through Keycloak reaches a delivered golden-path Service, and a request with no sign-in is refused",
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
    const result = await checkSignIn(repository, runner, target);
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

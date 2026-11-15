// The platform Backstage backend (plan 15 step 6). Sign-in is Keycloak OIDC
// only: no guest provider module is installed. Authorization is group-based
// (src/policy.js). Behaviour is chosen by the app-config the chart mounts.
import { createBackend } from "@backstage/backend-defaults";
import { createBackendModule } from "@backstage/backend-plugin-api";
import { policyExtensionPoint } from "@backstage/plugin-permission-node/alpha";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import { decide } from "./policy.js";

const operatorsPolicy = createBackendModule({
  pluginId: "permission",
  moduleId: "platform-operators-policy",
  register(env) {
    env.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy({
          async handle(_request, user) {
            const allowed = decide(user?.info.ownershipEntityRefs) === "ALLOW";
            return {
              result: allowed ? AuthorizeResult.ALLOW : AuthorizeResult.DENY,
            };
          },
        });
      },
    });
  },
});

const backend = createBackend();
backend.add(import("@backstage/plugin-auth-backend"));
backend.add(import("@backstage/plugin-auth-backend-module-oidc-provider"));
backend.add(import("@backstage/plugin-catalog-backend"));
backend.add(import("@backstage/plugin-kubernetes-backend"));
backend.add(import("@backstage/plugin-permission-backend"));
backend.add(operatorsPolicy);
backend.start();

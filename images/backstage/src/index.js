// The platform Backstage backend (plan 15 step 6). Sign-in is Keycloak OIDC
// only, resolved from the token's groups (src/signin.js); no other sign-in
// module is installed. Authorization is group-based (src/policy.js). The
// catalog is built from the Organization and Service objects (src/provider.js).
// Behaviour is chosen by the app-config the chart mounts.
import { readFile } from "node:fs/promises";
import { createBackend } from "@backstage/backend-defaults";
import { createBackendModule } from "@backstage/backend-plugin-api";
import { policyExtensionPoint } from "@backstage/plugin-permission-node/alpha";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import { coreServices } from "@backstage/backend-plugin-api";
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from "@backstage/plugin-auth-node";
import { catalogProcessingExtensionPoint } from "@backstage/plugin-catalog-node";
import { oidcAuthenticator } from "@backstage/plugin-auth-backend-module-oidc-provider";
import { decide } from "./policy.js";
import { listPlatformObjects } from "./kube.js";
import { createProvider } from "./provider.js";
import { resolveSignIn } from "./signin.js";

const TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token";

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

const oidcSignIn = createBackendModule({
  pluginId: "auth",
  moduleId: "platform-oidc-groups",
  register(env) {
    env.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: "oidc",
          factory: createOAuthProviderFactory({
            authenticator: oidcAuthenticator,
            signInResolver: resolveSignIn,
          }),
        });
      },
    });
  },
});

const platformCatalog = createBackendModule({
  pluginId: "catalog",
  moduleId: "platform-objects",
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        scheduler: coreServices.scheduler,
        log: coreServices.logger,
      },
      async init({ catalog, scheduler, log }) {
        const provider = createProvider({
          log,
          list: () =>
            listPlatformObjects({
              fetch,
              readToken: () => readFile(TOKEN, "utf8"),
            }),
        });
        catalog.addEntityProvider(provider);
        await scheduler.scheduleTask({
          id: "kore-platform-objects",
          frequency: { minutes: 1 },
          timeout: { seconds: 30 },
          fn: () => provider.refresh(),
        });
      },
    });
  },
});

const backend = createBackend();
backend.add(import("@backstage/plugin-auth-backend"));
backend.add(oidcSignIn);
backend.add(import("@backstage/plugin-catalog-backend"));
backend.add(import("@backstage/plugin-kubernetes-backend"));
backend.add(import("@backstage/plugin-permission-backend"));
backend.add(platformCatalog);
backend.add(operatorsPolicy);
backend.start();

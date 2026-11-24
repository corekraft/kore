import { beforeEach, expect, test, vi } from "vitest";
import { orderedComponents } from "./order.js";
import {
  agentgatewayMeshEnrollmentFlag,
  appDeliveryFlag,
  autoscalingFlag,
  platformArgocdDeliveryFlag,
  platformPortalFlag,
  platformSyncWindowFlag,
  portalStagedInstallFlag,
  startsAfterDelivery,
  componentGatedOff,
  enabledComponents,
  featureEnabled,
  featureHelmArgs,
  gatewayClassName,
  gatewayClassChangeFlag,
  gatewayRollbackOrderFlag,
  goldenPathSafetyDefaultsFlag,
  goldenPathSigninAfterPortalFlag,
  goldenPathSigninFlag,
  goldenPathTemplateAdmissionFlag,
  ingressFlag,
  readinessGatedOff,
  releaseRecoveryArgocdRefusalFlag,
  signinAwaitsPortal,
} from "./features.js";
import type { Environment } from "./types.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
} from "./config-support.js";

vi.mock("./order.js");

/** An environment whose feature flags are the given map (a flag may hold any value). */
function environment(features?: Record<string, unknown>): Environment {
  return fakeEnvironment(
    features === undefined
      ? {}
      : { features: features as Record<string, boolean> },
  );
}

beforeEach(() => {
  vi.mocked(orderedComponents).mockReturnValue([]);
});

test("a flag is on only when the overlay sets it to true, and an omitted flag is off", () => {
  const flags = environment({ "agent-loop": true, quiet: false });
  expect(featureEnabled(flags, "agent-loop")).toBe(true);
  expect(featureEnabled(flags, "quiet")).toBe(false);
  expect(featureEnabled(flags, "absent")).toBe(false);
});

test("a flag holding the string true is not on, because only a boolean turns a flag on", () => {
  expect(
    featureEnabled(environment({ "agent-loop": "true" }), "agent-loop"),
  ).toBe(false);
  expect(featureEnabled(environment(undefined), "agent-loop")).toBe(false);
});

test("the Helm arguments hand every declared flag to the chart, sorted by name, as booleans", () => {
  expect(
    featureHelmArgs(environment({ quiet: false, "agent-loop": true })),
  ).toEqual([
    "--set",
    "features.agent-loop=true",
    "--set",
    "features.quiet=false",
  ]);
});

test("an environment with no features map passes no Helm arguments", () => {
  expect(featureHelmArgs(environment(undefined))).toEqual([]);
});

test("the ingress flag selects agentgateway as the GatewayClass, and its absence selects Istio", () => {
  expect(ingressFlag).toBe("ingress-agentgateway");
  expect(gatewayClassName(environment({ [ingressFlag]: true }))).toBe(
    "agentgateway",
  );
  expect(gatewayClassName(environment({ [ingressFlag]: false }))).toBe("istio");
  expect(gatewayClassName(environment(undefined))).toBe("istio");
});

test("a component with a feature flag is gated off while the flag is off, and on once it is on", () => {
  const gated = fakeComponent({ featureFlag: "agent-loop" });
  expect(componentGatedOff(environment({ "agent-loop": false }), gated)).toBe(
    true,
  );
  expect(componentGatedOff(environment({ "agent-loop": true }), gated)).toBe(
    false,
  );
});

test("a component with no feature flag is never gated off", () => {
  const plain = fakeComponent();
  expect(componentGatedOff(environment(undefined), plain)).toBe(false);
});

test("the enabled components are the catalog in dependency order, minus those a flag gates off", () => {
  const components = [
    fakeComponent({ name: "kore-registry" }),
    fakeComponent({ name: "agent-loop-app", featureFlag: "agent-loop" }),
    fakeComponent({ name: "kore-ui" }),
  ];
  vi.mocked(orderedComponents).mockReturnValue(components);
  const repository = fakeRepository({
    catalog: fakeCatalog(components),
    environment: environment({ "agent-loop": false }),
  });

  expect(enabledComponents(repository)).toEqual([components[0], components[2]]);
  expect(vi.mocked(orderedComponents).mock.calls).toEqual([
    [repository.catalog],
  ]);
});

test("the autoscaling flag gates a component off until an overlay turns it on, and an omitted flag is off", () => {
  expect(autoscalingFlag).toBe("autoscaling-defaults");
  const gated = fakeComponent({ featureFlag: autoscalingFlag });
  expect(
    componentGatedOff(environment({ [autoscalingFlag]: false }), gated),
  ).toBe(true);
  expect(componentGatedOff(environment(undefined), gated)).toBe(true);
  expect(
    componentGatedOff(environment({ [autoscalingFlag]: true }), gated),
  ).toBe(false);
});

test("the platform Argo CD delivery flag gates a component off until an overlay turns it on, and an omitted flag is off", () => {
  expect(platformArgocdDeliveryFlag).toBe("platform-argocd-delivery");
  const gated = fakeComponent({ featureFlag: platformArgocdDeliveryFlag });
  expect(
    componentGatedOff(
      environment({ [platformArgocdDeliveryFlag]: false }),
      gated,
    ),
  ).toBe(true);
  expect(componentGatedOff(environment(undefined), gated)).toBe(true);
  expect(
    componentGatedOff(
      environment({ [platformArgocdDeliveryFlag]: true }),
      gated,
    ),
  ).toBe(false);
});

test("the platform sync window flag is named for the AppProject's maintenance deny window (issue 1540)", () => {
  expect(platformSyncWindowFlag).toBe("platform-sync-window");
});

test("the platform portal flag gates a component off until an overlay turns it on, and an omitted flag is off", () => {
  expect(platformPortalFlag).toBe("platform-portal");
  const gated = fakeComponent({ featureFlag: platformPortalFlag });
  expect(
    componentGatedOff(environment({ [platformPortalFlag]: false }), gated),
  ).toBe(true);
  expect(componentGatedOff(environment(undefined), gated)).toBe(true);
  expect(
    componentGatedOff(environment({ [platformPortalFlag]: true }), gated),
  ).toBe(false);
});

test("the class-change flag is its own switch, independent of the ingress flag", () => {
  expect(gatewayClassChangeFlag).toBe("gateway-class-change-release");
  expect(
    gatewayClassName(environment({ [gatewayClassChangeFlag]: true })),
  ).toBe("istio");
});

test("the rollback-order flag is its own switch, independent of the class-change and ingress flags", () => {
  expect(gatewayRollbackOrderFlag).toBe("gateway-rollback-order");
  expect(
    gatewayClassName(environment({ [gatewayRollbackOrderFlag]: true })),
  ).toBe("istio");
});

test("the mesh-enrollment flag is its own switch, independent of the ingress flag, and an omitted flag is off", () => {
  expect(agentgatewayMeshEnrollmentFlag).toBe("agentgateway-mesh-enrollment");
  expect(
    gatewayClassName(environment({ [agentgatewayMeshEnrollmentFlag]: true })),
  ).toBe("istio");
  expect(
    featureEnabled(environment(undefined), agentgatewayMeshEnrollmentFlag),
  ).toBe(false);
  expect(
    featureEnabled(
      environment({ [agentgatewayMeshEnrollmentFlag]: true }),
      agentgatewayMeshEnrollmentFlag,
    ),
  ).toBe(true);
});

test("a release that declares startsAfterDelivery starts after the delivery only while portal-staged-install is on", () => {
  const staged = fakeComponent({ startsAfterDelivery: true });

  expect(
    startsAfterDelivery(
      environment({ [portalStagedInstallFlag]: true }),
      staged,
    ),
  ).toBe(true);
  expect(
    startsAfterDelivery(
      environment({ [portalStagedInstallFlag]: false }),
      staged,
    ),
  ).toBe(false);
  expect(startsAfterDelivery(environment(), staged)).toBe(false);
});

test("a release that does not declare startsAfterDelivery never starts after the delivery, whatever the flag", () => {
  const on = environment({ [portalStagedInstallFlag]: true });

  expect(startsAfterDelivery(on, fakeComponent())).toBe(false);
  expect(
    startsAfterDelivery(on, fakeComponent({ startsAfterDelivery: false })),
  ).toBe(false);
});

test("the golden-path sign-in waits for the portal only while golden-path-signin, portal-staged-install and the after-portal flag are all on", () => {
  const all = environment({
    [goldenPathSigninFlag]: true,
    [portalStagedInstallFlag]: true,
    [goldenPathSigninAfterPortalFlag]: true,
  });

  expect(signinAwaitsPortal(all)).toBe(true);
  for (const off of [
    goldenPathSigninFlag,
    portalStagedInstallFlag,
    goldenPathSigninAfterPortalFlag,
  ]) {
    expect(
      signinAwaitsPortal({ features: { ...all.features, [off]: false } }),
    ).toBe(false);
  }
  expect(signinAwaitsPortal(environment())).toBe(false);
});

test("the after-portal flag is named golden-path-signin-after-portal and is off while an overlay omits it", () => {
  expect(goldenPathSigninAfterPortalFlag).toBe(
    "golden-path-signin-after-portal",
  );
  expect(
    featureEnabled(environment(undefined), goldenPathSigninAfterPortalFlag),
  ).toBe(false);
});

test("the recovery refusal flag is named release-recovery-argocd-refusal and is off while an overlay omits it", () => {
  expect(releaseRecoveryArgocdRefusalFlag).toBe(
    "release-recovery-argocd-refusal",
  );
  expect(
    featureEnabled(environment(undefined), releaseRecoveryArgocdRefusalFlag),
  ).toBe(false);
});

test("the app delivery flag is named app-delivery and is off while an overlay omits it (ADR 0172)", () => {
  expect(appDeliveryFlag).toBe("app-delivery");
  expect(featureEnabled(environment(undefined), appDeliveryFlag)).toBe(false);
  expect(
    featureEnabled(environment({ [appDeliveryFlag]: true }), appDeliveryFlag),
  ).toBe(true);
});

test("the safety defaults flag is named golden-path-safety-defaults and is off while an overlay omits it (ADR 0154)", () => {
  expect(goldenPathSafetyDefaultsFlag).toBe("golden-path-safety-defaults");
  expect(
    featureEnabled(environment(undefined), goldenPathSafetyDefaultsFlag),
  ).toBe(false);
  expect(
    featureEnabled(
      environment({ [goldenPathSafetyDefaultsFlag]: true }),
      goldenPathSafetyDefaultsFlag,
    ),
  ).toBe(true);
});

test("the template admission flag is named golden-path-template-admission and is off while an overlay omits it", () => {
  expect(goldenPathTemplateAdmissionFlag).toBe(
    "golden-path-template-admission",
  );
  expect(
    featureEnabled(environment(undefined), goldenPathTemplateAdmissionFlag),
  ).toBe(false);
});

test("the golden-path sign-in flag is named golden-path-signin and is off while an overlay omits it", () => {
  expect(goldenPathSigninFlag).toBe("golden-path-signin");
  expect(featureEnabled(environment(undefined), goldenPathSigninFlag)).toBe(
    false,
  );
  expect(
    featureEnabled(
      environment({ [goldenPathSigninFlag]: true }),
      goldenPathSigninFlag,
    ),
  ).toBe(true);
});

test("a readiness resource gated by a flag is skipped while that flag is off, and waited on once it is on (issue 1884)", () => {
  const component = {
    readinessFlags: {
      "clusterimagepolicy.policy.sigstore.dev/kore-template-images":
        goldenPathTemplateAdmissionFlag,
    },
  };
  const resource =
    "clusterimagepolicy.policy.sigstore.dev/kore-template-images";
  expect(readinessGatedOff(environment(undefined), component, resource)).toBe(
    true,
  );
  expect(
    readinessGatedOff(
      environment({ [goldenPathTemplateAdmissionFlag]: true }),
      component,
      resource,
    ),
  ).toBe(false);
  expect(
    readinessGatedOff(
      environment(undefined),
      component,
      "clusterimagepolicy.policy.sigstore.dev/kore-platform-images",
    ),
  ).toBe(false);
  expect(readinessGatedOff(environment(undefined), {}, resource)).toBe(false);
});

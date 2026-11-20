import { expect, test, vi } from "vitest";
import { enrollSharedGatewayRoute } from "./enrollment.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("./gated-release.js");
vi.mock("./image-inventory.js", () => ({
  enrollmentLabel: "policy.sigstore.dev/include",
}));

// Docs: docs/decisions/0134-the-shared-gateway-admits-routes-only-from-platform-labelled-namespaces.md
// A route waits for admission inside its own component's readiness check, so
// the namespace is labelled before that component, not after every phase (#1388).

const label = "platform.kore.dev/shared-gateway";
const otlpRoute = () =>
  fakeComponent({
    name: "kore-otlp-route",
    namespace: "observability",
    sharedGatewayRoutes: true,
    sharedGatewayRouteFlag: "otlp-route",
  });
const flags = (features: Record<string, boolean>) =>
  fakeRepository({ imageInventory: "audit", features });

/** Runs the enrollment and returns every command it ran. */
async function enroll(
  features: Record<string, boolean>,
  component = otlpRoute(),
) {
  const { runner, run } = fakeRunner();
  await enrollSharedGatewayRoute(flags(features), runner, component);
  return run.mock.calls.map(([command, args, options]) => ({
    command,
    args,
    input: options?.input ?? "",
  }));
}

test("a route component's namespace is labelled on its own, with both flags on, under the shared Gateway field manager", async () => {
  const [applied, ...rest] = await enroll({
    "platform-shared-gateway": true,
    "otlp-route": true,
  });
  expect(rest).toEqual([]);
  expect(applied!.command).toBe("kubectl");
  expect(applied!.args).toContain("apply");
  expect(applied!.args).toContain(
    "--field-manager=kore-shared-gateway-enrollment",
  );
  expect(applied!.input).toContain("name: observability");
  expect(applied!.input).toContain(`${label}: "true"`);
});

test("a route component's namespace is not labelled while its own route flag is off", async () => {
  expect(
    await enroll({ "platform-shared-gateway": true, "otlp-route": false }),
  ).toEqual([]);
});

test("a route component's namespace is not labelled while platform-shared-gateway is off", async () => {
  expect(
    await enroll({ "platform-shared-gateway": false, "otlp-route": true }),
  ).toEqual([]);
});

test("a component that attaches no route to the shared Gateway leaves its namespace alone", async () => {
  expect(
    await enroll(
      { "platform-shared-gateway": true },
      fakeComponent({ namespace: "other" }),
    ),
  ).toEqual([]);
});

test("a route component without its own route flag is labelled whenever platform-shared-gateway is on", async () => {
  const [applied] = await enroll(
    { "platform-shared-gateway": true },
    fakeComponent({ namespace: "kore-registry", sharedGatewayRoutes: true }),
  );
  expect(applied!.input).toContain("name: kore-registry");
});

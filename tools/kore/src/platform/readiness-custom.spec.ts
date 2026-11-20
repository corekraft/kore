import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { customCheck } from "./readiness-custom.js";
import { argocdApplicationsCheck } from "./readiness-argocd.js";
import { existenceCheck } from "./readiness-existence.js";
import { gatewayCheck } from "./readiness-gateway.js";

vi.mock("./readiness-argocd.js");
vi.mock("./readiness-existence.js");
vi.mock("./readiness-gateway.js");

const context = { repository: {}, runner: {} as Runner, base: [] } as never;
const argocd = { condition: "argocd", run: vi.fn() };
const gateway = { condition: "gateway", run: vi.fn() };
const existence = { condition: "exists and rollout complete", run: vi.fn() };

beforeEach(() => {
  vi.mocked(argocdApplicationsCheck).mockReturnValue(undefined);
  vi.mocked(gatewayCheck).mockReturnValue(undefined);
  vi.mocked(existenceCheck).mockReturnValue(undefined);
});

test("an operator-created resource gets the existence check, asked with the context and the resource", () => {
  vi.mocked(existenceCheck).mockReturnValue(existence);

  expect(customCheck(context, "statefulset/keycloak")).toBe(existence);
  expect(existenceCheck).toHaveBeenCalledWith(context, "statefulset/keycloak");
});

test("the Argo CD and gateway checks win over the existence check, which is then never asked", () => {
  vi.mocked(gatewayCheck).mockReturnValue(gateway);
  vi.mocked(existenceCheck).mockReturnValue(existence);

  expect(customCheck(context, "gateway/kore")).toBe(gateway);
  expect(existenceCheck).not.toHaveBeenCalled();
});

test("the Application collection gets the Argo CD check", () => {
  vi.mocked(argocdApplicationsCheck).mockReturnValue(argocd);

  expect(customCheck(context, "applications.argoproj.io")).toBe(argocd);
});

test("a Gateway or HTTPRoute gets the gateway check", () => {
  vi.mocked(gatewayCheck).mockReturnValue(gateway);

  expect(customCheck(context, "gateway/kore")).toBe(gateway);
});

test("the Argo CD check wins when both could apply, and the gateway check is never asked", () => {
  vi.mocked(argocdApplicationsCheck).mockReturnValue(argocd);
  vi.mocked(gatewayCheck).mockReturnValue(gateway);

  expect(customCheck(context, "applications.argoproj.io")).toBe(argocd);
  expect(gatewayCheck).not.toHaveBeenCalled();
});

test("the platform Organization gets its own Ready check, not a rollout", () => {
  expect(
    customCheck(context, "organization.platform.kore.dev/platform"),
  ).toMatchObject({ condition: "Ready, with the platform realm composed" });
});

test("any other resource has no custom check", () => {
  expect(customCheck(context, "deployment/web")).toBeUndefined();
});

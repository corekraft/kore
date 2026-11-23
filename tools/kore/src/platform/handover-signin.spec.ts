// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// The golden-path sign-in waits for the portal's Keycloak (issue 1880). Split from
// handover.spec.ts to keep both under the file-length limit.
import { beforeEach, expect, test, vi } from "vitest";
import {
  enabledComponents,
  helmInstalledComponents,
  releaseOwner,
  type Repository,
} from "../config/index.js";
import { awaitArgocdDelivery, awaitSigninApplications } from "./handover.js";
import { signinDeferred, waitForApplications } from "./readiness-argocd.js";
import { readinessFailure } from "./readiness.js";
import { pollUntil } from "./readiness-poll.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("./release-prerequisites.js");
vi.mock("./probe.js");
vi.mock("./reconcile.js");
vi.mock("./readiness.js");
vi.mock("./readiness-argocd.js");
// Only the poll is replaced: ReadinessTimeout stays the real error class.
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
}));

const delivery = fakeComponent({
  name: "kore-config-delivery",
  phase: "configuration",
  namespace: "argocd",
  timeout: "5m",
});
const opa = fakeComponent({
  name: "opa-authorizer",
  phase: "configuration",
  namespace: "opa-system",
  timeout: "3s",
  owner: "argocd",
  readiness: ["deployment/opa-authorizer"],
});
const portal = fakeComponent({
  name: "kore-platform-keycloak",
  phase: "configuration",
  namespace: "keycloak",
  timeout: "10m",
  startsAfterDelivery: true,
});

const repository: Repository = fakeRepository({
  provider: "k3d",
  kubeContext: "k3d-kore-local",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(helmInstalledComponents).mockReturnValue([]);
  vi.mocked(waitForApplications).mockResolvedValue(undefined);
  vi.mocked(pollUntil).mockResolvedValue(undefined);
  vi.mocked(readinessFailure).mockResolvedValue(undefined);
  vi.mocked(releaseOwner).mockImplementation((_environment, component) =>
    component.owner === "argocd" ? "argocd" : "kore",
  );
  vi.mocked(enabledComponents).mockReturnValue([delivery, opa]);
  vi.mocked(signinDeferred).mockReturnValue(false);
});

/** The sign-in waits for the portal, and the portal's Keycloak is in the enabled set. */
function signinAwaitsPortalOn(): void {
  vi.mocked(signinDeferred).mockReturnValue(true);
  vi.mocked(enabledComponents).mockReturnValue([delivery, opa, portal]);
}

test("with golden-path-signin and portal-staged-install both on, the delivery gate waits on the platform Applications only", async () => {
  signinAwaitsPortalOn();
  await awaitArgocdDelivery(repository, fakeRunner().runner);
  expect(waitForApplications).toHaveBeenCalledWith(
    expect.anything(),
    "5m",
    "platform",
  );
});

test("with either flag off the delivery gate waits on every Application, labelled or not", async () => {
  vi.mocked(signinDeferred).mockReturnValue(false);
  await awaitArgocdDelivery(repository, fakeRunner().runner);
  expect(waitForApplications).toHaveBeenCalledWith(
    expect.anything(),
    "5m",
    "all",
  );
});

test("when the sign-in is not deferred, the delivery gate waits on every Application, whatever the flags say", async () => {
  vi.mocked(signinDeferred).mockReturnValue(false);
  await awaitArgocdDelivery(repository, fakeRunner().runner);
  expect(waitForApplications).toHaveBeenCalledWith(
    expect.anything(),
    "5m",
    "all",
  );
});

test("with both flags on, the golden-path Applications are awaited after the portal, within the platform Keycloak's timeout", async () => {
  signinAwaitsPortalOn();
  const { runner } = fakeRunner();
  await awaitSigninApplications(repository, runner);
  expect(waitForApplications).toHaveBeenCalledWith(
    {
      repository,
      runner,
      base: ["--context", "k3d-kore-local", "--namespace", "argocd"],
    },
    "10m",
    "service",
  );
});

test("with either flag off there is no deferred golden-path wait", async () => {
  vi.mocked(signinDeferred).mockReturnValue(false);
  await awaitSigninApplications(repository, fakeRunner().runner);
  expect(waitForApplications).not.toHaveBeenCalled();
});

test("when the sign-in is not deferred, there is no golden-path wait after the portal", async () => {
  vi.mocked(signinDeferred).mockReturnValue(false);
  await awaitSigninApplications(repository, fakeRunner().runner);
  expect(waitForApplications).not.toHaveBeenCalled();
});

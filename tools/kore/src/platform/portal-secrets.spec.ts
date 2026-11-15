// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)
import { expect, test, vi } from "vitest";
import { ensureBackstageOidc } from "./backstage-oidc.js";
import { ensureKeycloakAdmin } from "./keycloak-admin.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { ensurePortalSecrets } from "./portal-secrets.js";

vi.mock("./backstage-oidc.js");
vi.mock("./keycloak-admin.js");

const repository = fakeRepository();

test("the Keycloak admin Secret is streamed before the Backstage sign-in Secrets, in the same environment", async () => {
  const order: string[] = [];
  vi.mocked(ensureKeycloakAdmin).mockImplementation(async () => {
    order.push("admin");
    return true;
  });
  vi.mocked(ensureBackstageOidc).mockImplementation(async () => {
    order.push("oidc");
    return true;
  });
  const { runner } = fakeRunner();
  await ensurePortalSecrets(repository, runner);
  expect(order).toEqual(["admin", "oidc"]);
  expect(ensureKeycloakAdmin).toHaveBeenCalledWith(repository, runner);
  expect(ensureBackstageOidc).toHaveBeenCalledWith(repository, runner);
});

test("a failed admin Secret stops the sign-in Secrets, so nothing half-applies behind it", async () => {
  vi.mocked(ensureKeycloakAdmin).mockRejectedValue(new Error("no cluster"));
  vi.mocked(ensureBackstageOidc).mockClear();
  const { runner } = fakeRunner();
  await expect(ensurePortalSecrets(repository, runner)).rejects.toThrow(
    "no cluster",
  );
  expect(ensureBackstageOidc).not.toHaveBeenCalled();
});

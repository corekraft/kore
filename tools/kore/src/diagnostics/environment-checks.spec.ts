// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md
import { expect, test, vi } from "vitest";
import { fakeRepository, fakeRunner } from "./diagnostics-support.js";
import { environmentChecks } from "./environment-checks.js";
import { registryNameCheck } from "./registry-name-check.js";
import { tokenSecretChecks } from "./token-secret-check.js";

vi.mock("./registry-name-check.js", () => ({ registryNameCheck: vi.fn() }));
vi.mock("./token-secret-check.js", () => ({ tokenSecretChecks: vi.fn() }));

test("the environment checks are the registry name, then each token Secret, each reading the repository and runner it was given", async () => {
  const registry = {
    name: "registry:name",
    status: "pass" as const,
    required: false,
    message: "answers /v2/",
  };
  const token = {
    name: "token:external-dns",
    status: "warn" as const,
    required: false,
    message: "absent",
  };
  vi.mocked(registryNameCheck).mockResolvedValue([registry]);
  vi.mocked(tokenSecretChecks).mockResolvedValue([token]);
  const repository = fakeRepository({ provider: "managed" });
  const { runner } = fakeRunner();

  expect(await environmentChecks(repository, runner)).toEqual([
    registry,
    token,
  ]);
  expect(registryNameCheck).toHaveBeenCalledWith(repository, runner);
  expect(tokenSecretChecks).toHaveBeenCalledWith(repository, runner);
});

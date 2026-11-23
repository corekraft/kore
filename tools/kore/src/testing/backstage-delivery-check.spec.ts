import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { checkBackstageDelivery } from "./backstage-delivery-check.js";
import { backstageDeliveryProgram } from "./backstage-delivery-program.js";
import { runHeadlessBrowser } from "./headless-browser.js";
import { withSignInTestUser } from "./signin-check.js";

const userName = "kore-signin-check-a1";
const throwawayPassword = "pw-generated-in-memory";

vi.mock("../config/index.js", () => ({
  gatewayEntryPort: 443,
  keycloakHostname: vi.fn(() => "keycloak.platform.kore.internal"),
  backstageHostname: vi.fn(() => "backstage.platform.kore.internal"),
}));
vi.mock("./headless-browser.js", () => ({
  pinnedBrowserImage: "mcr.microsoft.com/playwright:pinned",
  runHeadlessBrowser: vi.fn(),
}));
vi.mock("./signin-check.js", () => ({
  withSignInTestUser: vi.fn(),
  assertionsOf: vi.fn((reply: { assertions: unknown }) => reply.assertions),
  backstageSignInTarget: vi.fn(() => ({
    host: "backstage.platform.kore.internal",
    realm: "platform",
  })),
}));
vi.mock("./backstage-delivery-program.js", () => ({
  backstageDeliveryProgram: vi.fn(() => "program"),
}));

const repository = {
  environment: { kubeContext: "k3d-kore-local", name: "local" },
} as unknown as Repository;
const runner = { run: vi.fn() } as unknown as Runner;

const names = [
  "backstage identity carries the operators group",
  "catalog lists the delivered service",
  "kubernetes read returns the service's Argo CD Application with its sync and health",
  "kubernetes read returns the service's workload with its rollout",
];
const allHold = names.map((name) => ({ name, ok: true }));

function browserSays(assertions: { name: string; ok: boolean }[]): void {
  vi.mocked(runHeadlessBrowser).mockResolvedValue({ assertions });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withSignInTestUser).mockImplementation(
    async (_r, _run, _realm, run) => run(userName, throwawayPassword),
  );
  vi.mocked(backstageDeliveryProgram).mockReturnValue("program");
  browserSays(allHold);
});

describe("checkBackstageDelivery, the verdict", () => {
  it("passes only when the identity, the catalog entry, the Application and the workload all hold", async () => {
    const result = await checkBackstageDelivery(
      repository,
      runner,
      "golden-path-example",
    );
    expect(result.passed).toBe(true);
    expect(result.assertions.map((assertion) => assertion.name)).toEqual(names);
  });

  it("fails and names the assertion the browser reports not holding", async () => {
    browserSays(
      allHold.map((assertion, index) =>
        index === 2 ? { ...assertion, ok: false } : assertion,
      ),
    );
    const result = await checkBackstageDelivery(
      repository,
      runner,
      "golden-path-example",
    );
    expect(result.passed).toBe(false);
    expect(
      result.assertions.filter((assertion) => !assertion.ok).map((a) => a.name),
    ).toEqual([names[2]]);
  });
});

describe("checkBackstageDelivery, the browser run", () => {
  it("signs in as a throwaway operator in the platform realm and passes the password only as a secret", async () => {
    await checkBackstageDelivery(repository, runner, "golden-path-example");
    expect(withSignInTestUser).toHaveBeenCalledWith(
      repository,
      runner,
      "platform",
      expect.any(Function),
    );
    expect(runHeadlessBrowser).toHaveBeenCalledWith(runner, {
      image: "mcr.microsoft.com/playwright:pinned",
      program: "program",
      secrets: [throwawayPassword],
    });
  });

  it("builds the program for Backstage's host, Keycloak's host and the named service", async () => {
    await checkBackstageDelivery(repository, runner, "golden-path-example");
    expect(backstageDeliveryProgram).toHaveBeenCalledWith({
      host: "backstage.platform.kore.internal",
      keycloakHost: "keycloak.platform.kore.internal",
      port: 443,
      username: userName,
      password: throwawayPassword,
      service: "golden-path-example",
    });
  });

  it("refuses a service name that is not one DNS label before it creates a user", async () => {
    await expect(
      checkBackstageDelivery(repository, runner, "Bad Name/../x"),
    ).rejects.toThrow(/one DNS label/);
    expect(withSignInTestUser).not.toHaveBeenCalled();
  });
});

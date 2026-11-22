import { beforeEach, describe, expect, it, vi } from "vitest";
import { keycloakHostname, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { runHeadlessBrowser } from "./headless-browser.js";
import { KeycloakTestUsers } from "./keycloak-test-user.js";
import {
  backstageSignInTarget,
  checkSignIn,
  type SignInTarget,
} from "./signin-check.js";
import { backstageSignInPaths, signInProgram } from "./signin-program.js";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("../config/index.js", () => ({
  gatewayEntryPort: 443,
  backstageHostname: vi.fn(() => "backstage.kore.internal"),
  keycloakHostname: vi.fn(() => "keycloak.platform.kore.internal"),
}));
vi.mock("./headless-browser.js", () => ({
  pinnedBrowserImage: "mcr.microsoft.com/playwright:pinned",
  runHeadlessBrowser: vi.fn(),
}));
vi.mock("./keycloak-test-user.js", () => ({
  KeycloakTestUsers: { connect },
  defaultRealm: "platform",
}));
vi.mock("./signin-program.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./signin-program.js")>()),
  signInProgram: vi.fn(() => "program"),
}));

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;
const runner = {} as Runner;

const users = {
  create: vi.fn(async () => "u-42"),
  addToOperators: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

function browserSays(assertions: { name: string; ok: boolean }[]): void {
  vi.mocked(runHeadlessBrowser).mockResolvedValue({ assertions });
}

const bothHold = [
  { name: "signed-in call succeeds", ok: true },
  { name: "request with no sign-in is refused", ok: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue(users as unknown as KeycloakTestUsers);
  vi.mocked(signInProgram).mockReturnValue("program");
  browserSays(bothHold);
});

const passwordGiven = (): string =>
  vi.mocked(signInProgram).mock.calls[0]?.[0].password ?? "";

describe("checkSignIn", () => {
  it("fails and names the assertion when a request with no sign-in is not refused", async () => {
    browserSays([
      { name: "signed-in call succeeds", ok: true },
      { name: "request with no sign-in is refused", ok: false },
    ]);
    const result = await checkSignIn(repository, runner);
    expect(result.passed).toBe(false);
    expect(result.assertions.filter((a) => !a.ok).map((a) => a.name)).toEqual([
      "request with no sign-in is refused",
    ]);
  });

  it("passes only when every assertion holds", async () => {
    const result = await checkSignIn(repository, runner);
    expect(result.passed).toBe(true);
  });

  it("adds the test user to the operators group before the browser runs, and removes it after", async () => {
    await checkSignIn(repository, runner);
    expect(users.addToOperators).toHaveBeenCalledWith("u-42");
    expect(
      vi.mocked(users.addToOperators).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(runHeadlessBrowser).mock.invocationCallOrder[0] ?? 0,
    );
    expect(users.remove).toHaveBeenCalledWith("u-42");
  });

  it("removes the test user when the browser run fails, and rethrows the browser's error", async () => {
    vi.mocked(runHeadlessBrowser).mockRejectedValue(
      new Error("the sign-in redirect timed out"),
    );
    await expect(checkSignIn(repository, runner)).rejects.toThrow(
      "the sign-in redirect timed out",
    );
    expect(users.remove).toHaveBeenCalledWith("u-42");
  });

  it("keeps the original failure and names the user it could not remove", async () => {
    vi.mocked(runHeadlessBrowser).mockRejectedValue(
      new Error("the sign-in redirect timed out"),
    );
    users.remove.mockRejectedValueOnce(
      new Error("Keycloak refused to remove the test user u-42: HTTP 403"),
    );
    const failure = await checkSignIn(repository, runner).catch(
      (error: unknown) => error,
    );
    expect((failure as Error).message).toContain(
      "the sign-in redirect timed out",
    );
    expect((failure as Error).message).toContain("u-42");
    expect((failure as Error).message).toContain("HTTP 403");
  });

  it("never returns or throws the password it generated", async () => {
    const result = await checkSignIn(repository, runner);
    const password = passwordGiven();
    expect(password).not.toBe("");
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it("streams the password to the browser as a redaction secret", async () => {
    await checkSignIn(repository, runner);
    expect(vi.mocked(runHeadlessBrowser).mock.calls[0]?.[1].secrets).toEqual([
      passwordGiven(),
    ]);
  });

  it("rejects a browser result that holds no assertion list", async () => {
    vi.mocked(runHeadlessBrowser).mockResolvedValue({ status: 200 });
    await expect(checkSignIn(repository, runner)).rejects.toThrow(
      "no assertions",
    );
  });
});

describe("checkSignIn hosts", () => {
  it("hands the browser program the Keycloak and Backstage hosts the platform-domain helpers derive, from the environment", async () => {
    await checkSignIn(repository, runner);
    expect(keycloakHostname).toHaveBeenCalledWith(repository.environment);
    expect(signInProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "backstage.kore.internal",
        keycloakHost: "keycloak.platform.kore.internal",
      }),
    );
  });

  it("checks Backstage when no target is given: Backstage's host and paths, and the platform realm", async () => {
    await checkSignIn(repository, runner);
    expect(signInProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "backstage.kore.internal",
        paths: backstageSignInPaths,
      }),
    );
    expect(connect).toHaveBeenCalledWith(repository, runner, "platform");
  });

  it("names Backstage's target from the environment, with the platform realm", () => {
    expect(backstageSignInTarget(repository)).toEqual({
      host: "backstage.kore.internal",
      realm: "platform",
      paths: backstageSignInPaths,
    });
  });
});

const goldenPath: SignInTarget = {
  host: "golden-path-example.platform.kore.internal",
  realm: "golden",
  paths: {
    startPath: "/oauth2/authorization/golden-path",
    signedInCallPath: "/api/whoami",
    anonymousPath: "/api/whoami",
  },
};

describe("checkSignIn for a golden-path target", () => {
  it("hands the browser program the Service's host and paths, not Backstage's", async () => {
    await checkSignIn(repository, runner, goldenPath);
    expect(signInProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "golden-path-example.platform.kore.internal",
        keycloakHost: "keycloak.platform.kore.internal",
        paths: goldenPath.paths,
      }),
    );
  });

  it("creates and removes the throwaway user in the target's realm", async () => {
    await checkSignIn(repository, runner, goldenPath);
    expect(connect).toHaveBeenCalledWith(repository, runner, "golden");
    expect(users.remove).toHaveBeenCalledWith("u-42");
  });

  it("passes only when both assertions hold, and fails by name when its request with no sign-in is not refused", async () => {
    browserSays([
      { name: "signed-in call succeeds", ok: true },
      { name: "request with no sign-in is refused", ok: false },
    ]);
    const result = await checkSignIn(repository, runner, goldenPath);
    expect(result.passed).toBe(false);
    expect(result.assertions.filter((a) => !a.ok).map((a) => a.name)).toEqual([
      "request with no sign-in is refused",
    ]);
  });

  it("removes the golden-path test user after a failed browser run, and rethrows its error", async () => {
    vi.mocked(runHeadlessBrowser).mockRejectedValue(
      new Error("the sign-in redirect timed out"),
    );
    await expect(checkSignIn(repository, runner, goldenPath)).rejects.toThrow(
      "the sign-in redirect timed out",
    );
    expect(users.remove).toHaveBeenCalledWith("u-42");
  });

  it("never puts the password it generated in the result", async () => {
    const result = await checkSignIn(repository, runner, goldenPath);
    expect(passwordGiven()).not.toBe("");
    expect(JSON.stringify(result)).not.toContain(passwordGiven());
  });
});

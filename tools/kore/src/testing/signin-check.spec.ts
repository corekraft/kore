import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { runHeadlessBrowser } from "./headless-browser.js";
import { KeycloakTestUsers } from "./keycloak-test-user.js";
import { checkSignIn } from "./signin-check.js";
import { signInProgram } from "./signin-program.js";

vi.mock("../config/index.js", () => ({
  gatewayEntryPort: 443,
  platformPlan: vi.fn(() => ({
    domain: "kore.internal",
    organizationId: "platform",
  })),
}));
vi.mock("./headless-browser.js", () => ({
  pinnedBrowserImage: "mcr.microsoft.com/playwright:pinned",
  runHeadlessBrowser: vi.fn(),
}));
vi.mock("./keycloak-test-user.js", () => ({
  KeycloakTestUsers: { connect: vi.fn() },
}));
vi.mock("./signin-program.js", () => ({
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
  vi.mocked(KeycloakTestUsers).connect.mockResolvedValue(
    users as unknown as KeycloakTestUsers,
  );
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

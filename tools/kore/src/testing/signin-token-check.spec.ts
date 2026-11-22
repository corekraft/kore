import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { runHeadlessBrowser } from "./headless-browser.js";
import { withSignInTestUser } from "./signin-check.js";
import type { SignInTarget } from "./signin-check.js";
import { checkSessionTokens } from "./signin-token-check.js";
import { signInTokenProgram } from "./signin-token-program.js";

const userName = "kore-signin-check-a1";
const throwawayPassword = "pw-generated-in-memory";

vi.mock("../config/index.js", () => ({
  gatewayEntryPort: 443,
  keycloakHostname: vi.fn(() => "keycloak.platform.kore.internal"),
}));
vi.mock("./headless-browser.js", () => ({
  pinnedBrowserImage: "mcr.microsoft.com/playwright:pinned",
  runHeadlessBrowser: vi.fn(),
}));
vi.mock("./signin-check.js", () => ({
  withSignInTestUser: vi.fn(),
  assertionsOf: vi.fn((reply: { assertions: unknown }) => reply.assertions),
}));
vi.mock("./signin-token-program.js", () => ({
  signInTokenProgram: vi.fn(() => "program"),
}));

const repository = {
  environment: { kubeContext: "k3d-kore-local", name: "local" },
} as unknown as Repository;
const runner = { run: vi.fn() } as unknown as Runner;

const goldenPath: SignInTarget = {
  host: "golden-path-example.platform.kore.internal",
  realm: "golden",
  paths: {
    startPath: "/oauth2/authorization/golden-path",
    signedInCallPath: "/api/whoami",
    anonymousPath: "/api/whoami",
  },
};

const channels = [
  "signed-in call succeeds",
  "no token in localStorage",
  "no token in sessionStorage",
  "no token in non-HttpOnly cookies",
  "no token in response bodies visible to the page",
  "no token in URLs or redirects",
  "every session cookie is host-only, HttpOnly, Secure and SameSite",
];

const allHold = channels.map((name) => ({ name, ok: true }));

function browserSays(assertions: { name: string; ok: boolean }[]): void {
  vi.mocked(runHeadlessBrowser).mockResolvedValue({ assertions });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withSignInTestUser).mockImplementation(
    async (_r, _run, _realm, run) => run(userName, throwawayPassword),
  );
  vi.mocked(signInTokenProgram).mockReturnValue("program");
  browserSays(allHold);
});

describe("checkSessionTokens, the verdict", () => {
  it("passes only when every channel and the signed-in call hold", async () => {
    const result = await checkSessionTokens(repository, runner, goldenPath);
    expect(result.passed).toBe(true);
    expect(result.assertions.map((assertion) => assertion.name)).toEqual(
      channels,
    );
  });

  it("fails and names each channel the browser reports a token in", async () => {
    browserSays(
      allHold.map((assertion) =>
        assertion.name === "no token in URLs or redirects"
          ? { ...assertion, ok: false, tokens: 1 }
          : assertion,
      ),
    );
    const result = await checkSessionTokens(repository, runner, goldenPath);
    expect(result.passed).toBe(false);
    expect(result.assertions.filter((assertion) => !assertion.ok)).toEqual([
      { name: "no token in URLs or redirects", ok: false, tokens: 1 },
    ]);
  });

  it("never returns the password it generated", async () => {
    const result = await checkSessionTokens(repository, runner, goldenPath);
    expect(JSON.stringify(result)).not.toContain(throwawayPassword);
  });
});

describe("checkSessionTokens, the user, the browser and the refusals", () => {
  it("creates the throwaway user through the shared helper in the target's realm", async () => {
    await checkSessionTokens(repository, runner, goldenPath);
    expect(withSignInTestUser).toHaveBeenCalledWith(
      repository,
      runner,
      "golden",
      expect.any(Function),
    );
  });

  it("hands the program the Service's host, Keycloak's host, the gateway port and the target's own paths", async () => {
    await checkSessionTokens(repository, runner, goldenPath);
    expect(signInTokenProgram).toHaveBeenCalledWith({
      host: "golden-path-example.platform.kore.internal",
      keycloakHost: "keycloak.platform.kore.internal",
      port: 443,
      username: userName,
      password: throwawayPassword,
      paths: goldenPath.paths,
    });
  });

  it("gives the browser the runner and streams the password only as a redaction secret", async () => {
    await checkSessionTokens(repository, runner, goldenPath);
    const [passedRunner, run] =
      vi.mocked(runHeadlessBrowser).mock.calls[0] ?? [];
    expect(passedRunner).toBe(runner);
    expect(run?.program).toBe("program");
    expect(run?.secrets).toEqual([throwawayPassword]);
  });

  it("rethrows the browser's own error, so the user removal in the helper sees it", async () => {
    vi.mocked(runHeadlessBrowser).mockRejectedValue(
      new Error("the sign-in redirect timed out"),
    );
    await expect(
      checkSessionTokens(repository, runner, goldenPath),
    ).rejects.toThrow("the sign-in redirect timed out");
  });

  it("refuses a target with no paths of its own before any user is created", async () => {
    await expect(
      checkSessionTokens(repository, runner, {
        host: "backstage.kore.internal",
        realm: "platform",
      }),
    ).rejects.toThrow("needs the target's own sign-in paths");
    expect(withSignInTestUser).not.toHaveBeenCalled();
    expect(runHeadlessBrowser).not.toHaveBeenCalled();
  });
});

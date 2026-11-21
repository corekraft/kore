import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { KeycloakTestUsers } from "./keycloak-test-user.js";

vi.mock("../config/index.js", () => ({
  gatewayEntryPort: 443,
  keycloakHostname: vi.fn(() => "keycloak.platform.kore.internal"),
}));

const password = "Tq9-pass_w0rd-Zx7";
const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;

const adminSecret = JSON.stringify({
  data: {
    username: Buffer.from("kore-admin").toString("base64"),
    password: Buffer.from("admin-secret-value").toString("base64"),
  },
});
const tokenJson = '{"access_token":"tok-123"}';

function replyTo(
  command: string,
  input: string,
  answer: (curlConfig: string) => string,
): string {
  if (command === "kubectl") {
    return adminSecret;
  }
  return input.includes("openid-connect/token") ? tokenJson : answer(input);
}

interface Call {
  command: string;
  args: readonly string[];
  input?: string | undefined;
}

/**
 * A runner that answers kubectl with the admin Secret, the token request with a
 * token, and every other curl request with what `answer` returns for its config.
 */
function fakeRunner(answer: (curlConfig: string) => string) {
  const calls: Call[] = [];
  const run = vi.fn(
    async (
      command: string,
      args: readonly string[],
      options?: { input?: string },
    ) => {
      const input = options?.input;
      calls.push({ command, args, input });
      const stdout = replyTo(command, input ?? "", answer);
      return { stdout, stderr: "", code: 0 };
    },
  );
  const curlCalls = () => calls.filter((call) => call.command === "curl");
  return { runner: { run } as unknown as Runner, calls, curlCalls };
}

const created =
  "HTTP/2 201\nlocation: https://keycloak.kore.internal/admin/realms/platform/users/u-42\n\n";

describe("KeycloakTestUsers", () => {
  it("reads the admin password from the Secret and sends it only on curl's stdin", async () => {
    const { runner, calls, curlCalls } = fakeRunner(() => created);
    await KeycloakTestUsers.connect(repository, runner);
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain("admin-secret-value");
    }
    expect(curlCalls()[0]?.input).toContain("admin-secret-value");
  });

  it("reaches Keycloak at the host the platform-domain helper derives, through the gateway", async () => {
    const { runner, curlCalls } = fakeRunner(() => created);
    await KeycloakTestUsers.connect(repository, runner);
    const token = curlCalls()[0];
    expect(token?.args).toContain(
      "keycloak.platform.kore.internal:443:127.0.0.1",
    );
    expect(token?.input).toContain(
      'url = "https://keycloak.platform.kore.internal/realms/master/protocol/openid-connect/token"',
    );
  });

  it("creates a user with the password in the request body and returns the id from the Location header", async () => {
    const { runner, curlCalls } = fakeRunner(() => created);
    const users = await KeycloakTestUsers.connect(repository, runner);
    expect(await users.create("kore-signin-check-a1", password)).toBe("u-42");
    const create = curlCalls().at(-1);
    expect(create?.args.join(" ")).not.toContain(password);
    expect(create?.input).toContain(password);
    expect(create?.input).toContain("kore-signin-check-a1");
  });

  it("refuses a create Keycloak does not accept, naming the status and never the password", async () => {
    const { runner } = fakeRunner(
      () => 'HTTP/2 409\n\n{"errorMessage":"User exists"}',
    );
    const users = await KeycloakTestUsers.connect(repository, runner);
    const failure = await users
      .create("kore-signin-check-a1", password)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("HTTP 409");
    expect((failure as Error).message).not.toContain(password);
  });

  it("adds the user to the platform-operators group found by its path under platform", async () => {
    const { runner, curlCalls } = fakeRunner((config) =>
      config.includes("group-by-path/platform/platform-operators")
        ? 'HTTP/2 200\n\n{"id":"g-9","name":"platform-operators"}'
        : "HTTP/2 204\n\n",
    );
    const users = await KeycloakTestUsers.connect(repository, runner);
    await users.addToOperators("u-42");
    const put = curlCalls().at(-1);
    expect(put?.input).toContain(
      "/admin/realms/platform/users/u-42/groups/g-9",
    );
    expect(put?.input).toContain('request = "PUT"');
  });

  it("removes the user with a DELETE and fails loudly when Keycloak refuses it", async () => {
    const { runner, curlCalls } = fakeRunner(() => "HTTP/2 403\n\n");
    const users = await KeycloakTestUsers.connect(repository, runner);
    await expect(users.remove("u-42")).rejects.toThrow("HTTP 403");
    const del = curlCalls().at(-1);
    expect(del?.input).toContain("/admin/realms/platform/users/u-42");
    expect(del?.input).toContain('request = "DELETE"');
  });
});

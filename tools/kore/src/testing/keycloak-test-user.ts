import type { Repository } from "../config/index.js";
import { gatewayEntryPort, keycloakHostname } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)

const namespace = "keycloak";
const adminSecretName = "keycloak-admin";
const realm = "platform";
const operatorsGroupPath = "platform/platform-operators";

interface Reply {
  status: number;
  location?: string | undefined;
  body: string;
}

/** One curl config line. The value is JSON-quoted, which curl reads back as the same text. */
const line = (key: string, value: string): string =>
  `${key} = ${JSON.stringify(value)}`;

function curlArguments(host: string): string[] {
  return [
    "--silent",
    "--show-error",
    "--insecure",
    "--resolve",
    `${host}:${gatewayEntryPort}:127.0.0.1`,
    "--config",
    "-",
  ];
}

function expectStatus(reply: Reply, expected: number, what: string): void {
  if (reply.status !== expected) {
    throw new Error(`Keycloak refused to ${what}: HTTP ${reply.status}`);
  }
}

/**
 * Reads the bootstrap admin credentials from the Secret and asks Keycloak for an
 * admin token. The admin password goes to curl on its stdin only.
 */
async function adminToken(
  repository: Repository,
  runner: Runner,
  host: string,
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      namespace,
      "get",
      "secret",
      adminSecretName,
      "--output=json",
    ],
    { capture: true },
  );
  const data = (JSON.parse(stdout) as { data?: Record<string, string> }).data;
  if (data?.["username"] === undefined || data["password"] === undefined) {
    throw new Error(
      `the ${adminSecretName} Secret in ${namespace} has no admin credentials; run kore platform up so Keycloak is installed first`,
    );
  }
  const username = Buffer.from(data["username"], "base64").toString("utf8");
  const password = Buffer.from(data["password"], "base64").toString("utf8");
  const { stdout: tokenBody } = await runner.run("curl", curlArguments(host), {
    capture: true,
    input: [
      line(
        "url",
        `https://${host}/realms/master/protocol/openid-connect/token`,
      ),
      line("data-urlencode", "grant_type=password"),
      line("data-urlencode", "client_id=admin-cli"),
      line("data-urlencode", `username=${username}`),
      line("data-urlencode", `password=${password}`),
    ].join("\n"),
  });
  const token = (JSON.parse(tokenBody) as { access_token?: unknown })
    .access_token;
  if (typeof token !== "string") {
    throw new Error(
      "Keycloak issued no admin token; check that the keycloak-admin Secret matches the running Keycloak",
    );
  }
  return token;
}

/**
 * Creates, groups and removes the throwaway users of the sign-in check through
 * the platform Keycloak's admin REST API, reached through the platform gateway.
 * The admin password is read from the bootstrap Secret into memory and sent to
 * curl only on its stdin; every user password travels the same way, never in an
 * argument, on disk or in a message.
 */
export class KeycloakTestUsers {
  private constructor(
    private readonly runner: Runner,
    private readonly host: string,
    private token: string,
    private readonly renew: () => Promise<string>,
  ) {}

  /** Signs in as the bootstrap admin, which the platform Keycloak keeps for the life of the install. */
  static async connect(
    repository: Repository,
    runner: Runner,
  ): Promise<KeycloakTestUsers> {
    const host = keycloakHostname(repository.environment);
    const renew = () => adminToken(repository, runner, host);
    return new KeycloakTestUsers(runner, host, await renew(), renew);
  }

  /**
   * Creates an enabled user with a password, and returns its id. The user has a
   * name, a verified email and no required actions, so Keycloak's VERIFY_PROFILE
   * and UPDATE_PASSWORD actions cannot stop the sign-in. The realm's default
   * required actions stay as they are; only this user is shaped. The email uses
   * the reserved .invalid domain, so no mail is ever sent.
   */
  async create(username: string, password: string): Promise<string> {
    const reply = await this.send("POST", `/admin/realms/${realm}/users`, {
      username,
      enabled: true,
      firstName: "Sign-in",
      lastName: "Check",
      email: `${username}@example.invalid`,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: "password", value: password, temporary: false }],
    });
    expectStatus(reply, 201, `create the test user ${username}`);
    const id = reply.location?.split("/").at(-1);
    if (id === undefined || id === "") {
      throw new Error(
        `Keycloak created ${username} but its Location header named no id`,
      );
    }
    return id;
  }

  /** Adds the user to the platform-operators group, which sits under platform. */
  async addToOperators(userId: string): Promise<void> {
    const group = await this.send(
      "GET",
      `/admin/realms/${realm}/group-by-path/${operatorsGroupPath}`,
    );
    expectStatus(group, 200, "find the platform-operators group");
    const groupId = (JSON.parse(group.body) as { id?: string }).id;
    if (groupId === undefined) {
      throw new Error("Keycloak named no id for the platform-operators group");
    }
    const put = await this.send(
      "PUT",
      `/admin/realms/${realm}/users/${userId}/groups/${groupId}`,
    );
    expectStatus(put, 204, `add user ${userId} to platform-operators`);
  }

  /**
   * Removes the user. The admin token can expire while the browser waits, so a 401
   * gets one retry with a freshly issued token. A refusal after that is an error,
   * because a leftover user is a finding.
   */
  async remove(userId: string): Promise<void> {
    const path = `/admin/realms/${realm}/users/${userId}`;
    let reply = await this.send("DELETE", path);
    if (reply.status === 401) {
      this.token = await this.renew();
      reply = await this.send("DELETE", path);
    }
    expectStatus(reply, 204, `remove the test user ${userId}`);
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Reply> {
    const config = [
      line("url", `https://${this.host}${path}`),
      "include",
      line("header", `Authorization: Bearer ${this.token}`),
      line("header", "Content-Type: application/json"),
    ];
    if (method !== "GET") {
      config.push(line("request", method));
    }
    if (body !== undefined) {
      config.push(line("data-binary", JSON.stringify(body)));
    }
    const { stdout } = await this.runner.run("curl", curlArguments(this.host), {
      capture: true,
      input: config.join("\n"),
    });
    const [head = "", ...rest] = stdout.split(/\r?\n\r?\n/);
    const statuses = [...head.matchAll(/^HTTP\/\S+\s+(\d{3})/gm)];
    return {
      status: Number(statuses.at(-1)?.[1] ?? 0),
      location: /^location:\s*(\S+)/im.exec(head)?.[1],
      body: rest.join("\n\n"),
    };
  }
}

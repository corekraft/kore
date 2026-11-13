import { createSign } from "node:crypto";
import type { CliDeps } from "../runtime/index.js";

/** Where the owner runs the wizard that creates the identities and fills the keychain. */
export const WIZARD = "tools/harness/wizards/identities.sh";

const ACCOUNT = "kore";
const REPOSITORY = "kore";
const API = "https://api.github.com";
const JWT_LIFETIME_SECONDS = 540;
const CLOCK_SKEW_SECONDS = 60;
const MINT_TIMEOUT_SECONDS = 20;

/** Keychain services (account `kore`) holding each identity's material. */
const SERVICE = {
  appId: "kore.writer.app-id",
  installationId: "kore.writer.installation-id",
  privateKey: "kore.writer.private-key",
  judgePat: "kore.judge.pat",
} as const;

/** What the writer's installation token may do; nothing beyond the App's own grant. */
const WRITER_GRANT = {
  repositories: [REPOSITORY],
  permissions: {
    contents: "write",
    pull_requests: "write",
    metadata: "read",
  },
};

export type RoleToken = { token: string } | { error: string };

/** The keychain item's value; an error naming the item and the wizard when it is missing or empty. */
async function fromKeychain(
  deps: CliDeps,
  service: string,
  identity: string,
): Promise<RoleToken> {
  const read = await deps.runner.run("security", [
    "find-generic-password",
    "-s",
    service,
    "-a",
    ACCOUNT,
    "-w",
  ]);
  const value = read.stdout.trim();
  return read.code === 0 && value !== ""
    ? { token: value }
    : {
        error: `The ${identity} identity is missing: keychain item ${service} was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
      };
}

const base64url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

/** The App's JWT: RS256, signed in this process so the key never reaches a child or argv. */
function appJwt(appId: string, pem: string, now: Date): string {
  const issued = Math.floor(now.getTime() / 1000) - CLOCK_SKEW_SECONDS;
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iat: issued,
      exp: issued + JWT_LIFETIME_SECONDS,
      iss: appId,
    }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(pem);
  return `${unsigned}.${base64url(signature)}`;
}

/** curl's status line plus GitHub's own `message` when the body has one; never the raw body, which could hold a token. */
function githubReason(result: { stdout: string; stderr: string }): string {
  let message = "";
  try {
    const body = JSON.parse(result.stdout) as { message?: unknown };
    message = typeof body.message === "string" ? `: ${body.message}` : "";
  } catch {
    message = "";
  }
  return `${result.stderr.trim()}${message}`;
}

async function mintWriter(deps: CliDeps): Promise<RoleToken> {
  const [appId, installationId, key] = [
    await fromKeychain(deps, SERVICE.appId, "writer"),
    await fromKeychain(deps, SERVICE.installationId, "writer"),
    await fromKeychain(deps, SERVICE.privateKey, "writer"),
  ];
  for (const item of [appId, installationId, key]) {
    if ("error" in item) {
      return item;
    }
  }
  const [id, installation, stored] = [appId, installationId, key].map(
    (item) => (item as { token: string }).token,
  ) as [string, string, string];
  let jwt: string;
  try {
    jwt = appJwt(
      id,
      Buffer.from(stored, "base64").toString(),
      deps.clock.now(),
    );
  } catch {
    return {
      error: `The writer App private key in keychain item ${SERVICE.privateKey} could not sign a token. Recreate it with \`bash ${WIZARD}\`. No pane was split.`,
    };
  }
  // The JWT goes through curl's config on stdin, never argv.
  const minted = await deps.runner.run(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail-with-body",
      "--max-time",
      String(MINT_TIMEOUT_SECONDS),
      "--request",
      "POST",
      "--config",
      "-",
      "--data",
      JSON.stringify(WRITER_GRANT),
      `${API}/app/installations/${installation}/access_tokens`,
    ],
    {
      input: [
        `header = "Authorization: Bearer ${jwt}"`,
        'header = "Accept: application/vnd.github+json"',
        'header = "X-GitHub-Api-Version: 2022-11-28"',
        "",
      ].join("\n"),
    },
  );
  const reason = minted.code === 0 ? "" : githubReason(minted);
  let token: unknown;
  try {
    token =
      minted.code === 0
        ? (JSON.parse(minted.stdout) as { token?: unknown }).token
        : undefined;
  } catch {
    token = undefined;
  }
  return typeof token === "string" && token !== ""
    ? { token }
    : {
        error: `Could not mint a kore-writer installation token (${minted.code === 0 ? "the response carried no token" : reason}). Check the App is installed on corekraft/kore and its key is current: \`bash ${WIZARD}\`. No pane was split.`,
      };
}

/**
 * The GitHub token a role's pane gets: a minted installation token for a
 * writer, the keychain PAT for the judge. Every other role, the orchestrator
 * included, gets none (undefined) and the keychain is not read.
 */
export async function roleToken(
  deps: CliDeps,
  role: string,
): Promise<RoleToken | undefined> {
  if (role === "writer") {
    return await mintWriter(deps);
  }
  if (role === "judge") {
    return await fromKeychain(deps, SERVICE.judgePat, "judge");
  }
  return undefined;
}

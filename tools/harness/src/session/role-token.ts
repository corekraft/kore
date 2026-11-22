import { createSign } from "node:crypto";
import { FlagError, environments, readOverlay } from "../flag/index.js";
import type { CliDeps } from "../runtime/index.js";
import { WIZARD, identityItem } from "./identity-store.js";
import type { RoleToken } from "./identity-store.js";

const REPOSITORY = "kore";
const API = "https://api.github.com";
const JWT_LIFETIME_SECONDS = 540;
const CLOCK_SKEW_SECONDS = 60;
const MINT_TIMEOUT_SECONDS = 20;

/** Keychain service (account `kore`) holding the judge's PAT. */
const JUDGE_PAT_SERVICE = "kore.judge.pat";

/** A GitHub App identity: its keychain items, its name, and the grant its installation token asks for. */
interface AppIdentity {
  /** The identity's name, as the missing-item and wizard messages say it. */
  readonly label: "writer" | "reviewer" | "orchestrator" | "judge";
  /** The App's name, as the mint error says it. */
  readonly app: string;
  readonly service: {
    readonly appId: string;
    readonly installationId: string;
    readonly privateKey: string;
  };
  /** What the installation token may do; nothing beyond the App's own grant. */
  readonly grant: {
    readonly repositories: readonly string[];
    readonly permissions: Readonly<Record<string, string>>;
  };
}

/** The GitHub Apps. Each one is installed on the repository only, and its grant is its own. */
const APPS = {
  writer: {
    label: "writer",
    app: "kore-writer",
    service: {
      appId: "kore.writer.app-id",
      installationId: "kore.writer.installation-id",
      privateKey: "kore.writer.private-key",
    },
    grant: {
      repositories: [REPOSITORY],
      permissions: {
        contents: "write",
        pull_requests: "write",
        metadata: "read",
      },
    },
  },
  reviewer: {
    label: "reviewer",
    app: "kore-reviewer",
    service: {
      appId: "kore.reviewer.app-id",
      installationId: "kore.reviewer.installation-id",
      privateKey: "kore.reviewer.private-key",
    },
    grant: {
      repositories: [REPOSITORY],
      permissions: {
        pull_requests: "write",
        contents: "read",
        metadata: "read",
      },
    },
  },
  judge: {
    label: "judge",
    app: "kore-judge",
    service: {
      appId: "kore.judge.app-id",
      installationId: "kore.judge.installation-id",
      privateKey: "kore.judge.private-key",
    },
    grant: {
      repositories: [REPOSITORY],
      permissions: {
        pull_requests: "write",
        contents: "read",
        metadata: "read",
      },
    },
  },
  orchestrator: {
    label: "orchestrator",
    app: "kore-orchestrator",
    service: {
      appId: "kore.orchestrator.app-id",
      installationId: "kore.orchestrator.installation-id",
      privateKey: "kore.orchestrator.private-key",
    },
    grant: {
      repositories: [REPOSITORY],
      permissions: {
        issues: "write",
        pull_requests: "write",
        contents: "read",
        metadata: "read",
      },
    },
  },
} as const satisfies Record<string, AppIdentity>;

/** The identity a role's pane gets: one GitHub App's token, or the judge's PAT. A role not listed gets none. */
const IDENTITY_OF_ROLE: ReadonlyMap<string, keyof typeof APPS> = new Map([
  ["writer", "writer"],
  ["judge", "judge"],
  ["principles-review", "reviewer"],
  ["orchestrator", "orchestrator"],
  ["advisor", "orchestrator"],
]);

export type { RoleToken };

/** Whether a role has a GitHub identity of its own, so it gets a token when the role-tokens flag is on. */
export const hasIdentity = (role: string): boolean =>
  IDENTITY_OF_ROLE.has(role);

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

/** A GitHub App's installation token, minted with its own JWT and narrowed to its own grant. */
async function mintApp(deps: CliDeps, app: AppIdentity): Promise<RoleToken> {
  const { service, label } = app;
  const [appId, installationId, key] = [
    await identityItem(deps, service.appId, label),
    await identityItem(deps, service.installationId, label),
    await identityItem(deps, service.privateKey, label),
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
      error: `The ${label} App private key in keychain item ${service.privateKey} could not sign a token. Recreate it with \`bash ${WIZARD}\`. No pane was split.`,
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
      JSON.stringify(app.grant),
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
        error: `Could not mint a ${app.app} installation token (${minted.code === 0 ? "the response carried no token" : reason}). Check the App is installed on corekraft/kore and its key is current: \`bash ${WIZARD}\`. No pane was split.`,
      };
}

/** The feature flag (ADR 0077) that turns role tokens on, in the local environment overlay; off unless true. */
export const ROLE_TOKENS_FLAG = "role-tokens";
const FLAG_ENVIRONMENT = "local";

/** The feature flag (ADR 0077) that makes writer panes act as the owner and judge panes use the kore-judge App; off unless true. */
export const OWNER_WRITER_FLAG = "owner-writer";

/** Whether the local overlay turns a flag on. No overlay means off; a malformed one throws a FlagError. */
async function localFlag(deps: CliDeps, flag: string): Promise<boolean> {
  const root = await deps.root();
  if (!(await environments(deps.fs, root)).includes(FLAG_ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(deps.fs, root, FLAG_ENVIRONMENT);
  return overlay.features[flag] === true;
}

/** Whether the local overlay turns role tokens on. No overlay means off; a malformed one throws a FlagError. */
export const roleTokensOn = (deps: CliDeps): Promise<boolean> =>
  localFlag(deps, ROLE_TOKENS_FLAG);

/** The owner's own gh login token, read in the main session; an error telling the owner to log in when there is none. */
async function ownerToken(deps: CliDeps): Promise<RoleToken> {
  const read = await deps.runner.run("gh", ["auth", "token"]);
  const value = read.stdout.trim();
  return read.code === 0 && value !== ""
    ? { token: value }
    : {
        error:
          "The owner-writer flag is on but `gh auth token` returned no token. Run `gh auth login`, then rerun. No pane was split.",
      };
}

/**
 * The GitHub token a role's pane gets: a minted installation token for the
 * writer, the reviewer and the orchestrator Apps (the advisor pane uses the
 * orchestrator's, ADR 0120), the keychain PAT for the judge. Items come from
 * the macOS keychain, or on Linux from the sops-encrypted identity store. With the
 * owner-writer flag also on, the writer gets the owner's own gh login token
 * and the judge a minted kore-judge installation token instead. Every other
 * role, the main session included, gets none (undefined)
 * and the keychain is not read. So does every role while the role-tokens flag
 * is off, so spawn behaves as it did before.
 */
export async function roleToken(
  deps: CliDeps,
  role: string,
): Promise<RoleToken | undefined> {
  const identity = IDENTITY_OF_ROLE.get(role);
  if (identity === undefined) {
    return undefined;
  }
  let ownerWriter = false;
  try {
    if (!(await roleTokensOn(deps))) {
      return undefined;
    }
    ownerWriter = await localFlag(deps, OWNER_WRITER_FLAG);
  } catch (error) {
    if (error instanceof FlagError) {
      return { error: `${error.message} No pane was split.` };
    }
    throw error;
  }
  if (ownerWriter && identity === "writer") {
    return await ownerToken(deps);
  }
  return identity === "judge" && !ownerWriter
    ? await identityItem(deps, JUDGE_PAT_SERVICE, "judge")
    : await mintApp(deps, APPS[identity]);
}

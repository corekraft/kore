import {
  smtpSecretName,
  smtpSecretNamespace,
  type Repository,
} from "../config/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)

export interface SmtpCredentials {
  user: string;
  password: string;
}

const usage =
  'stream {"user": "<smtp user>", "password": "<smtp password>"} on stdin';

/** Reads the SMTP login from stdin text; never echoes the text in an error. */
export function parseSmtpCredentials(text: string): SmtpCredentials {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`SMTP credentials are not JSON; ${usage}`);
    }
    throw error;
  }
  const { user, password } = (value ?? {}) as Record<string, unknown>;
  if (
    typeof user !== "string" ||
    user === "" ||
    typeof password !== "string" ||
    password === ""
  ) {
    throw new Error(`SMTP credentials need a user and a password; ${usage}`);
  }
  return { user, password };
}

/**
 * Applies the Secret Grafana's SMTP settings read their login from. The login
 * reaches the cluster only on kubectl's stdin, never to disk, an argument or git.
 */
export async function applySmtpCredentials(
  repository: Repository,
  runner: Runner,
  credentials: SmtpCredentials,
): Promise<void> {
  await withSecretsRedacted([credentials.password], async () => {
    await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "apply",
        "--server-side",
        "--field-manager=kore-grafana-smtp",
        "--force-conflicts",
        "--filename=-",
      ],
      {
        capture: true,
        input: JSON.stringify({
          apiVersion: "v1",
          kind: "Secret",
          metadata: { name: smtpSecretName, namespace: smtpSecretNamespace },
          type: "Opaque",
          stringData: {
            user: credentials.user,
            password: credentials.password,
          },
        }),
      },
    );
  });
}

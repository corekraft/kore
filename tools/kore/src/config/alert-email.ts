import { featureEnabled, platformPortalFlag } from "./features.js";
import type { Environment, Repository } from "./types.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0034-registry-authentication-and-authorization.md (stream-only Secrets)

/** The Grafana contact point, and the Secret reference its SMTP login comes from. */
const contactPointName = "kore-platform-email";
export const smtpSecretName = "grafana-smtp";
export const smtpSecretNamespace = "observability";

/**
 * The operator-local source of the alert settings. The repository is public, so
 * the address is never committed: kore reads it from the environment it runs in,
 * over anything the overlay says (which stays unset).
 */
const addressVariable = "KORE_ALERT_EMAIL_ADDRESSES";
const smtpVariables = {
  host: "KORE_ALERT_SMTP_HOST",
  port: "KORE_ALERT_SMTP_PORT",
  from: "KORE_ALERT_SMTP_FROM",
} as const;
type SmtpField = keyof typeof smtpVariables;
const smtpFields = Object.keys(smtpVariables) as SmtpField[];

const address = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
const separator = /[;,]/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Settings {
  addresses: unknown;
  smtp: Record<string, unknown>;
}

/** The overlay's settings with the operator's environment variables laid over them. */
function settings(
  environment: Pick<Environment, "alertEmail">,
  env: NodeJS.ProcessEnv,
): Settings {
  const block: Record<string, unknown> = isObject(environment.alertEmail)
    ? environment.alertEmail
    : {};
  const configured: unknown = block["smtp"];
  const smtp: Record<string, unknown> = isObject(configured)
    ? { ...configured }
    : {};
  for (const field of smtpFields) {
    const value = env[smtpVariables[field]];
    if (value) {
      smtp[field] = field === "port" ? Number(value) : value;
    }
  }
  const fromEnv = env[addressVariable];
  return {
    addresses: fromEnv
      ? fromEnv
          .split(separator)
          .map((a) => a.trim())
          .filter(Boolean)
      : block["addresses"],
    smtp,
  };
}

const where = (field: SmtpField): string =>
  `set ${smtpVariables[field]} or environment.alertEmail.smtp.${field}`;

function addressErrors(addresses: unknown, smtp: Settings["smtp"]): string[] {
  if (addresses === undefined) {
    return [];
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return [
      `the alert address list must hold at least one address; set ${addressVariable} or environment.alertEmail.addresses, or leave both unset`,
    ];
  }
  const invalid = addresses.filter(
    (a) => typeof a !== "string" || !address.test(a),
  ).length;
  return [
    ...(invalid
      ? [
          `${invalid} alert address(es) are not email addresses; fix ${addressVariable} or environment.alertEmail.addresses`,
        ]
      : []),
    ...smtpFields
      .filter((field) => smtp[field] === undefined)
      .map(
        (field) =>
          `alert SMTP ${field} is required when an alert address is set; ${where(field)}`,
      ),
  ];
}

function smtpErrors(smtp: Settings["smtp"]): string[] {
  const { host, port, from } = smtp;
  const errors: string[] = [];
  if (host !== undefined && (typeof host !== "string" || host === "")) {
    errors.push(`alert SMTP host must be a host name; ${where("host")}`);
  }
  if (
    port !== undefined &&
    (typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535)
  ) {
    errors.push(
      `alert SMTP port must be an integer from 1 to 65535; ${where("port")}`,
    );
  }
  if (from !== undefined && (typeof from !== "string" || !address.test(from))) {
    errors.push(`alert SMTP from must be an email address; ${where("from")}`);
  }
  return errors;
}

const credentialFields = ["user", "username", "password", "pass"];

/**
 * Errors in the alert email settings, from the overlay and the operator's
 * environment; an unset address is valid (it is the operator's to set).
 */
export function alertEmailErrors(
  environment: Pick<Environment, "alertEmail">,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const block: unknown = environment.alertEmail;
  if (block !== undefined && !isObject(block)) {
    return ["environment.alertEmail must be an object"];
  }
  const merged = settings(environment, env);
  const configuredSmtp: unknown = isObject(block) ? block["smtp"] : undefined;
  const smtpBlock = isObject(configuredSmtp) ? configuredSmtp : {};
  return [
    ...addressErrors(merged.addresses, merged.smtp),
    ...smtpErrors(merged.smtp),
    ...credentialFields
      .filter((field) => smtpBlock[field] !== undefined)
      .map(
        (field) =>
          `environment.alertEmail.smtp.${field} is not allowed: stream SMTP credentials with kore secrets smtp (ADR 0034), never in config or git`,
      ),
  ];
}

const hasAddresses = (
  merged: Settings,
): merged is Settings & { addresses: string[] } =>
  Array.isArray(merged.addresses) && merged.addresses.length > 0;

/** The contact point name when alerts email somewhere: the flag is on and an address is set. */
export function alertContactPoint(
  environment: Pick<Environment, "alertEmail" | "features">,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return featureEnabled(environment, platformPortalFlag) &&
    hasAddresses(settings(environment, env))
    ? contactPointName
    : undefined;
}

/** The actionable warning while the portal is on and no address is set. */
export function alertEmailWarnings(
  repository: Pick<Repository, "environment">,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return featureEnabled(repository.environment, platformPortalFlag) &&
    !hasAddresses(settings(repository.environment, env))
    ? [
        `alerts have no contact point: set ${addressVariable} (and ${smtpVariables.host}, ${smtpVariables.port}, ${smtpVariables.from}) in the shell that runs kore, then stream the SMTP login with kore secrets smtp; the address is never committed (the repository is public); until then the default alerts show only in Grafana`,
      ]
    : [];
}

/**
 * Helm arguments carrying the alert email settings. Grafana owns the contact
 * point and policy; the service rules only carry its name. The SMTP login
 * is a Secret reference, so no credential is ever in an argument.
 */
export function alertEmailHelmArgs(
  environment: Pick<Environment, "alertEmail" | "features">,
  component: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const destination = alertContactPoint(environment, env);
  const merged = settings(environment, env);
  if (destination === undefined || !hasAddresses(merged)) {
    return [];
  }
  if (component === "kore-service-observability") {
    return ["--set-string", `alerts.destination=${destination}`];
  }
  if (component !== "grafana") {
    return [];
  }
  const reference = (key: string) => ({
    secretKeyRef: { name: smtpSecretName, key, optional: true },
  });
  return [
    "--set-json",
    `alerting=${JSON.stringify({
      "contactpoints.yaml": {
        apiVersion: 1,
        contactPoints: [
          {
            orgId: 1,
            name: destination,
            receivers: [
              {
                uid: destination,
                type: "email",
                settings: {
                  addresses: merged.addresses.join(";"),
                  singleEmail: true,
                },
              },
            ],
          },
        ],
      },
      "policies.yaml": {
        apiVersion: 1,
        policies: [
          {
            orgId: 1,
            receiver: destination,
            group_by: ["service", "alertname"],
          },
        ],
      },
    })}`,
    "--set-json",
    `grafana\\.ini.smtp=${JSON.stringify({
      enabled: true,
      host: `${String(merged.smtp["host"])}:${String(merged.smtp["port"])}`,
      from_address: String(merged.smtp["from"]),
    })}`,
    "--set-json",
    `envValueFrom=${JSON.stringify({
      GF_SMTP_USER: reference("user"),
      GF_SMTP_PASSWORD: reference("password"),
    })}`,
  ];
}

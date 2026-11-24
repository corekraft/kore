// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The overlay's backup declaration: its typed target, retention and daily schedule,
// and the refusals kore validate makes before any cluster is touched. Reads files
// only; the recipients come from .sops.yaml, read once by loadRepository.
import { schemaErrors, type SchemaNode } from "./schema-subset.js";
import { isAgeRecipient, PLACEHOLDER_RECIPIENT } from "./sops-recipients.js";
import type { BackupDeclaration, Environment, Repository } from "./types.js";

/** The flags that run a backup job; each is on only where a backup target is declared (ADR 0155). */
export const backupFlags = ["database-backups", "openbao-snapshots"];

/** The backup declaration against its schema: a closed object, a closed kind, the newest 14 daily kept. */
export const backupSchema: SchemaNode = {
  type: "object",
  required: ["target", "retention", "schedule"],
  properties: {
    target: {
      type: "object",
      required: [
        "endpoint",
        "bucket",
        "region",
        "pathStyle",
        "credentials",
        "kind",
      ],
      properties: {
        endpoint: {
          type: "string",
          pattern: "^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$",
        },
        bucket: {
          type: "string",
          pattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$",
        },
        region: { type: "string", pattern: "^[a-z0-9-]+$" },
        pathStyle: { type: "boolean" },
        caBundle: { type: "string", minLength: 1 },
        credentials: {
          type: "object",
          required: ["secret"],
          properties: {
            secret: {
              type: "string",
              pattern: "^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$",
            },
          },
        },
        kind: { enum: ["interim", "off-host"] },
      },
    },
    retention: {
      type: "object",
      required: ["daily"],
      properties: { daily: { type: "integer", const: 14 } },
    },
    schedule: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
  },
};

const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The host an endpoint names, or undefined when it does not parse (the schema reports that). */
function hostOf(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return undefined;
  }
}

/**
 * An off-host target lies outside the box and its cluster. The repository never
 * holds the box's public address, so every IP address is refused; a name inside
 * the cluster, or under the platform domain the box serves, is refused too.
 */
function offHostErrors(
  declared: BackupDeclaration,
  platformDomain: string | undefined,
): string[] {
  const { target } = declared;
  if (target?.kind !== "off-host" || typeof target.endpoint !== "string") {
    return [];
  }
  const host = hostOf(target.endpoint);
  if (host === undefined) {
    return [];
  }
  const where =
    "name an endpoint outside the box and its cluster, for example https://s3.example.com, or set backup.target.kind to interim (ADR 0155)";
  if (ipv4.test(host)) {
    return [
      `backup.target.endpoint ${host} is an IP address; an off-host target needs a name outside the box, since the repository holds no address of the box to compare with: use the provider's endpoint name, for example https://s3.example.com, or set backup.target.kind to interim (ADR 0155)`,
    ];
  }
  if (
    platformDomain !== undefined &&
    (host === platformDomain || host.endsWith(`.${platformDomain}`))
  ) {
    return [
      `backup.target.endpoint ${host} is under the platform domain ${platformDomain}, which the box serves, so an off-host target would live on the box; ${where}`,
    ];
  }
  if (!host.includes(".") || /\.(local|svc)$/.test(host)) {
    return [
      `backup.target.endpoint ${host} is a cluster-internal name, so an off-host target would live on the box; ${where}`,
    ];
  }
  return [];
}

/** A backup flag turned on where no backup target is declared (ADR 0155). */
function flagWithoutTargetErrors(environment: Environment): string[] {
  if (environment.backup !== undefined) {
    return [];
  }
  return backupFlags
    .filter((name) => environment.features?.[name] === true)
    .map(
      (name) =>
        `flag ${name} is on in the ${environment.name} overlay but backup.target is not declared; declare backup.target, or turn ${name} off (ADR 0155)`,
    );
}

/**
 * The age recipients the declared target encrypts to: at least one, each a
 * public key and none still the placeholder (ADR 0155).
 */
function recipientErrors(
  environment: Environment,
  recipients: string[] | undefined,
): string[] {
  const name = environment.name;
  const entries = (recipients ?? []).filter((entry) => entry !== "");
  if (entries.length === 0) {
    return [
      `.sops.yaml has no age recipient for environments/${name}/ secrets, so backup.target cannot encrypt backups to it; add the public age recipient (age1...) to that creation rule (ADR 0155)`,
    ];
  }
  return entries.flatMap((entry) => {
    if (entry === PLACEHOLDER_RECIPIENT) {
      return [
        `the age recipient in .sops.yaml for ${name} is still the placeholder ${PLACEHOLDER_RECIPIENT}; set it to the public age recipient (age1...) you generated (ADR 0155)`,
      ];
    }
    return isAgeRecipient(entry)
      ? []
      : [
          `"${entry}" in .sops.yaml is not a valid age recipient for ${name} (expected age1 followed by 58 characters); set the public recipient printed by age-keygen`,
        ];
  });
}

/**
 * Errors of the overlay's backup declaration and of the backup flags against it:
 * the declaration's shape, an off-host target that lies on the box, a backup flag
 * on with no target, and a declared target with no usable age recipient.
 */
export function backupTargetErrors(repository: Repository): string[] {
  const { environment } = repository;
  const declared = environment.backup;
  if (declared === undefined) {
    return flagWithoutTargetErrors(environment);
  }
  return [
    ...schemaErrors(backupSchema, declared, "backup"),
    ...offHostErrors(declared, environment.platform?.domain),
    ...recipientErrors(environment, repository.sopsRecipients),
  ];
}

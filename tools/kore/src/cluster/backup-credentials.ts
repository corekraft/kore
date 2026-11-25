// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The backup credential documents: sops Secrets that hold one S3 access key. The
// write-only one is applied to the cluster for the job; the read and delete ones are
// read only by the controller and never applied. Parsing refuses a document that is
// not a Secret of the expected name, and an error names the key, never a value.
import type { S3Credentials } from "./backup-s3.js";

/** The keys a credential Secret holds; the job reads the same names from its environment. */
export const ACCESS_KEY_ID = "AWS_ACCESS_KEY_ID";
export const SECRET_ACCESS_KEY = "AWS_SECRET_ACCESS_KEY";

export interface CredentialDocument {
  /** The namespace the document names, where its Secret belongs. */
  namespace: string | undefined;
  credentials: S3Credentials;
}

function stringKey(
  data: Record<string, unknown> | undefined,
  key: string,
  path: string,
): string {
  const value = data?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `${path} has no stringData.${key}; set that key with sops, then rerun`,
    );
  }
  return value;
}

/**
 * The access key a decrypted document holds, refused unless it is a Secret of the
 * given name. `text` is sops's JSON output; the caller decrypts and never writes it.
 */
export function credentialFromDocument(
  text: string,
  name: string,
  path: string,
): CredentialDocument {
  const document = (JSON.parse(text) ?? {}) as {
    kind?: unknown;
    metadata?: { name?: unknown; namespace?: unknown };
    stringData?: Record<string, unknown>;
  };
  if (document.kind !== "Secret" || document.metadata?.name !== name) {
    throw new Error(
      `${path} is not a Secret named ${name}; set kind and metadata.name with sops, then rerun`,
    );
  }
  const namespace =
    typeof document.metadata.namespace === "string"
      ? document.metadata.namespace
      : undefined;
  return {
    namespace,
    credentials: {
      accessKeyId: stringKey(document.stringData, ACCESS_KEY_ID, path),
      secretAccessKey: stringKey(document.stringData, SECRET_ACCESS_KEY, path),
    },
  };
}

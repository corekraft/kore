// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// Applies the write-only backup credential the backup job holds. Only this one is
// applied to the cluster: the read and delete credentials stay on the controller.
// Dark-launched behind database-backups, so with the flag off nothing is read.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { featureEnabled, type Repository } from "../config/index.js";
import {
  credentialFromDocument,
  type CredentialDocument,
} from "../cluster/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

const checksumAnnotation = "platform.kore.dev/document-sha256";

export interface AppliedBackupCredential {
  secret: string;
  namespace: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the encrypted document and decrypts it in memory. The checksum is over the
 * encrypted bytes, so an unchanged document changes nothing. Every refusal names the
 * document and the fix, and comes before the cluster is touched.
 */
async function readCredential(
  path: string,
  name: string,
  runner: Runner,
): Promise<{ checksum: string; document: CredentialDocument }> {
  let encrypted: Buffer;
  try {
    encrypted = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `no credential document at ${path}; create it with sops as a Secret named ${name}, with stringData.AWS_ACCESS_KEY_ID and stringData.AWS_SECRET_ACCESS_KEY, then rerun kore secrets backup`,
      );
    }
    throw error;
  }
  let text: string;
  try {
    text = (
      await runner.run("sops", ["--decrypt", "--output-type", "json", path], {
        capture: true,
      })
    ).stdout;
  } catch (error) {
    throw new Error(
      `could not decrypt ${path}: ${errorText(error)}; check that SOPS_AGE_KEY_FILE holds this environment's age identity, then rerun kore secrets backup`,
    );
  }
  return {
    checksum: createHash("sha256").update(encrypted).digest("hex"),
    document: credentialFromDocument(text, name, path),
  };
}

/**
 * Applies the write-only credential's Secret, decrypted from its sops document and
 * streamed to kubectl on stdin, never printed or written. A flag that is off applies
 * nothing and returns undefined.
 */
export async function applyBackupCredential(
  repository: Repository,
  runner: Runner,
): Promise<AppliedBackupCredential | undefined> {
  const { environment, root } = repository;
  if (!featureEnabled(environment, "database-backups")) {
    return undefined;
  }
  if (environment.backup === undefined) {
    throw new Error(
      `no backup.target is declared for ${environment.name}; declare backup.target in the ${environment.name} overlay before applying its credential (ADR 0155)`,
    );
  }
  const name = environment.backup.target.credentials.secret;
  const path = join(
    root,
    "infra/environments",
    environment.name,
    "secrets",
    `${name}.enc.yaml`,
  );
  const { checksum, document } = await readCredential(path, name, runner);
  const { namespace, credentials } = document;
  if (namespace === undefined) {
    throw new Error(
      `${path} names no namespace; set metadata.namespace with sops, then rerun kore secrets backup`,
    );
  }
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name,
      namespace,
      annotations: { [checksumAnnotation]: checksum },
    },
    type: "Opaque",
    stringData: {
      AWS_ACCESS_KEY_ID: credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    },
  };
  await withSecretsRedacted(
    [credentials.accessKeyId, credentials.secretAccessKey],
    async () =>
      await runner.run(
        "kubectl",
        [
          "--context",
          environment.kubeContext,
          "--namespace",
          namespace,
          "apply",
          "--server-side",
          "--field-manager=kore-backup",
          "--filename=-",
        ],
        { capture: true, input: `${JSON.stringify(secret)}\n` },
      ),
  );
  return { secret: name, namespace };
}

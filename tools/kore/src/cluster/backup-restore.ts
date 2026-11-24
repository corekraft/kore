import type { BackupManifest } from "./backup-manifest.js";
import { sha256 } from "./export-manifest.js";

/**
 * Decrypts a stored backup only after its bytes match the manifest and the
 * server has the PostgreSQL major the dump came from. `decrypt` is the one
 * place age runs; the checks above it never let a bad object reach it.
 */
export async function decryptBackup(
  manifest: BackupManifest,
  serverMajor: number,
  ciphertext: string,
  decrypt: (ciphertext: string) => Promise<string>,
): Promise<string> {
  if (
    sha256(ciphertext) !== manifest.artifact.sha256.toLowerCase() ||
    Buffer.byteLength(ciphertext) !== manifest.artifact.bytes
  ) {
    throw new Error(
      "the stored object does not match its manifest (digest or size differs); nothing was decrypted",
    );
  }
  const { postgresMajor } = manifest.dump;
  if (postgresMajor !== serverMajor) {
    throw new Error(
      `the backup was taken from PostgreSQL ${postgresMajor} and this server is ${serverMajor}; restore needs the same major, so nothing was decrypted`,
    );
  }
  return await decrypt(ciphertext);
}

import { createHash } from "node:crypto";

/** The `sha256:<64 hex digits>` digest of a file's text, as the release locks write their own digests. */
export function sha256Digest(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

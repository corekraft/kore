import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4Request {
  method: string;
  /** The canonical path: each segment already URI-encoded, slashes kept. */
  path: string;
  /** Lower-case header names; must include `host` and `x-amz-date`. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, which SigV4 signs with the request. */
  payloadHash: string;
}

export interface SigV4Scope {
  region: string;
  service: string;
}

/** The basic ISO 8601 UTC form SigV4 signs, for example 20150830T123600Z. */
export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:-]/g, "");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * The Authorization header value for one request, built with Node's own
 * crypto so no SDK is a runtime dependency. The signed headers are every
 * header the request carries, sorted by name.
 */
export function authorization(
  request: SigV4Request,
  credentials: SigV4Credentials,
  scope: SigV4Scope,
  date: string,
): string {
  const names = Object.keys(request.headers).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${request.headers[name]!.trim()}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    request.method,
    request.path,
    "",
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join("\n");
  const day = date.slice(0, 8);
  const credentialScope = `${day}/${scope.region}/${scope.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const key = [scope.region, scope.service, "aws4_request"].reduce<Buffer>(
    (previous, part) => hmac(previous, part),
    hmac(`AWS4${credentials.secretAccessKey}`, day),
  );
  const signature = createHmac("sha256", key)
    .update(stringToSign, "utf8")
    .digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

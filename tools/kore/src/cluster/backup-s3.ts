import {
  amzDate,
  authorization as signedAuthorization,
  type SigV4Credentials,
} from "./backup-sigv4.js";
import { sha256 } from "./export-manifest.js";

export interface S3Target {
  /** The endpoint's origin, for example https://s3.example.com. */
  endpoint: string;
  bucket: string;
  region: string;
  /** Path-style addresses the bucket in the path; otherwise in the host name. */
  pathStyle: boolean;
}

export interface S3Credentials extends SigV4Credentials {
  sessionToken?: string;
}

/** The one write this program makes: an object is stored, never replaced. */
export interface ObjectStore {
  put: (
    key: string,
    body: Buffer<ArrayBuffer>,
    contentType: string,
  ) => Promise<void>;
}

/** The target already holds this key, so the run is refused and nothing is replaced. */
export class ObjectExistsError extends Error {
  constructor(key: string, bucket: string) {
    super(
      `${key} already exists in ${bucket}; a backup never overwrites an object, so this run is refused`,
    );
    this.name = "ObjectExistsError";
  }
}

const TIMEOUT_MS = 15 * 60 * 1000;
const DETAIL_CHARS = 300;

/** RFC 3986 unreserved characters only, as SigV4 requires. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * An S3-compatible object store over fetch, with no SDK. Every put is
 * conditional (If-None-Match: *), so a key that exists is refused by the
 * target itself, not only by a check made before the write.
 */
export function s3ObjectStore(options: {
  target: S3Target;
  credentials: S3Credentials;
  now?: () => Date;
  fetch?: typeof fetch;
}): ObjectStore {
  const { target, credentials } = options;
  const now = options.now ?? (() => new Date());
  const send = options.fetch ?? fetch;
  const endpoint = new URL(target.endpoint);
  const host = target.pathStyle
    ? endpoint.host
    : `${target.bucket}.${endpoint.host}`;
  const bucketPrefix = target.pathStyle ? `/${target.bucket}` : "";
  return {
    async put(key, body, contentType) {
      const path = `${bucketPrefix}/${key.split("/").map(encodeSegment).join("/")}`;
      const date = amzDate(now());
      const signed: Record<string, string> = {
        "content-type": contentType,
        "if-none-match": "*",
        "x-amz-content-sha256": sha256(body),
        "x-amz-date": date,
      };
      if (credentials.sessionToken !== undefined) {
        signed["x-amz-security-token"] = credentials.sessionToken;
      }
      const authorization = signedAuthorization(
        {
          method: "PUT",
          path,
          headers: { host, ...signed },
          payloadHash: signed["x-amz-content-sha256"]!,
        },
        credentials,
        { region: target.region, service: "s3" },
        date,
      );
      const response = await send(`${endpoint.protocol}//${host}${path}`, {
        method: "PUT",
        body,
        headers: { ...signed, authorization },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) {
        return;
      }
      if (response.status === 412) {
        throw new ObjectExistsError(key, target.bucket);
      }
      const detail = (await response.text()).slice(0, DETAIL_CHARS).trim();
      throw new Error(
        `storing ${key} in ${target.bucket} failed with HTTP ${response.status}: ${detail}`,
      );
    },
  };
}

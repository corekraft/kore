// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The controller's list and remove over the same SigV4 signing as the job's store.
// The read and delete credentials are held only on the controller; the box never
// gets this module's credentials.
import {
  amzDate,
  authorization as signedAuthorization,
} from "./backup-sigv4.js";
import type { S3Credentials, S3Target } from "./backup-s3.js";
import { sha256 } from "./export-manifest.js";

/** What the controller prune reads and removes in the target. */
export interface ObjectAdmin {
  /** Every key under the prefix, across pages, as the target lists them. */
  list: (prefix: string) => Promise<string[]>;
  /** Removes one object. An object already absent is not an error, so a rerun finishes. */
  remove: (key: string) => Promise<void>;
}

type Call = (
  method: "GET" | "DELETE",
  path: string,
  query: string,
) => Promise<Response>;

const TIMEOUT_MS = 15 * 60 * 1000;
const DETAIL_CHARS = 300;
/** The elements a ListObjectsV2 page carries: each object's key, and the next page's token. */
const KEY_ELEMENT = /<Key>([^<]*)<\/Key>/g;
const NEXT_TOKEN_ELEMENT =
  /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/;

/** RFC 3986 unreserved characters only, as SigV4 requires. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A canonical query: sorted by name, each name and value encoded. */
function canonicalQuery(
  parameters: readonly (readonly [string, string])[],
): string {
  return [...parameters]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join("&");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The object keys a ListObjectsV2 page names, in the order the target lists them. */
function keysIn(body: string): string[] {
  return [...body.matchAll(KEY_ELEMENT)].map(([, key]) =>
    unescapeXml(key ?? ""),
  );
}

/** The token that names the next page, or undefined when the page names none. */
function nextTokenIn(body: string): string | undefined {
  const match = NEXT_TOKEN_ELEMENT.exec(body);
  return match === null ? undefined : unescapeXml(match[1] ?? "");
}

async function failure(
  response: Response,
  bucket: string,
  operation: string,
): Promise<Error> {
  const detail = (await response.text()).slice(0, DETAIL_CHARS).trim();
  return new Error(
    `${operation} from ${bucket} failed with HTTP ${response.status}: ${detail}`,
  );
}

/** Sends one request, signed with the credential, to the endpoint's host and path. */
function signedCall(
  connection: {
    endpoint: URL;
    host: string;
    target: S3Target;
    credentials: S3Credentials;
  },
  now: () => Date,
  send: typeof fetch,
): Call {
  const { endpoint, host, target, credentials } = connection;
  const emptyDigest = sha256("");
  return async (method, path, query) => {
    const date = amzDate(now());
    const signed: Record<string, string> = {
      "x-amz-content-sha256": emptyDigest,
      "x-amz-date": date,
    };
    if (credentials.sessionToken !== undefined) {
      signed["x-amz-security-token"] = credentials.sessionToken;
    }
    const authorization = signedAuthorization(
      {
        method,
        path,
        query,
        headers: { host, ...signed },
        payloadHash: emptyDigest,
      },
      credentials,
      { region: target.region, service: "s3" },
      date,
    );
    return await send(
      `${endpoint.protocol}//${host}${path}${query === "" ? "" : `?${query}`}`,
      {
        method,
        headers: { ...signed, authorization },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  };
}

/** One ListObjectsV2 page: its keys and the token of the next page, if any. */
async function listPage(
  call: Call,
  bucketPrefix: string,
  bucket: string,
  prefix: string,
  token: string | undefined,
): Promise<{ keys: string[]; next: string | undefined }> {
  const parameters: [string, string][] = [
    ["list-type", "2"],
    ["prefix", prefix],
  ];
  if (token !== undefined) {
    parameters.push(["continuation-token", token]);
  }
  const response = await call(
    "GET",
    `${bucketPrefix}/`,
    canonicalQuery(parameters),
  );
  if (!response.ok) {
    throw await failure(response, bucket, `listing ${prefix}`);
  }
  const body = await response.text();
  const keys = keysIn(body);
  if (!/<IsTruncated>true<\/IsTruncated>/.test(body)) {
    return { keys, next: undefined };
  }
  const next = nextTokenIn(body);
  if (next === undefined) {
    throw new Error(
      `the listing of ${prefix} in ${bucket} is truncated but names no continuation token; nothing was deleted`,
    );
  }
  return { keys, next };
}

/**
 * The controller's S3 admin over fetch, with no SDK. Requests are signed with the
 * credential given, and a failure names the operation, the status and the target's
 * own reply, never a credential.
 */
export function s3ObjectAdmin(options: {
  target: S3Target;
  credentials: S3Credentials;
  now?: () => Date;
  fetch?: typeof fetch;
}): ObjectAdmin {
  const { target } = options;
  const endpoint = new URL(target.endpoint);
  const host = target.pathStyle
    ? endpoint.host
    : `${target.bucket}.${endpoint.host}`;
  const bucketPrefix = target.pathStyle ? `/${target.bucket}` : "";
  const call = signedCall(
    { endpoint, host, target, credentials: options.credentials },
    options.now ?? (() => new Date()),
    options.fetch ?? fetch,
  );

  return {
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await listPage(
          call,
          bucketPrefix,
          target.bucket,
          prefix,
          token,
        );
        keys.push(...page.keys);
        token = page.next;
      } while (token !== undefined);
      return keys;
    },
    async remove(key) {
      const path = `${bucketPrefix}/${key.split("/").map(encodeRfc3986).join("/")}`;
      const response = await call("DELETE", path, "");
      if (response.ok || response.status === 404) {
        return;
      }
      throw await failure(response, target.bucket, `removing ${key}`);
    },
  };
}

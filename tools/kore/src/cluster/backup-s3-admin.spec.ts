import { beforeEach, expect, test, vi } from "vitest";
import { amzDate, authorization } from "./backup-sigv4.js";
import { s3ObjectAdmin } from "./backup-s3-admin.js";
import { sha256 } from "./export-manifest.js";

vi.mock("./backup-sigv4.js");
vi.mock("./export-manifest.js");

const KEY = "vps/golden-path/pg-main/app/2026-11-23T04-05-06Z.sql.age";
const NOW = new Date("2026-11-23T04:05:06.000Z");
const READ = { accessKeyId: "AK-READ", secretAccessKey: "SK-READ-SECRET" };
const EMPTY_DIGEST = "digest-of-nothing";

const pathStyle = {
  endpoint: "https://s3.example.com",
  bucket: "backups",
  region: "eu-west-1",
  pathStyle: true,
};

/** A ListObjectsV2 page: its keys, and a continuation token when more follow. */
function page(keys: string[], next?: string): Response {
  const contents = keys.map((key) => `<Contents><Key>${key}</Key></Contents>`);
  const tail =
    next === undefined
      ? "<IsTruncated>false</IsTruncated>"
      : `<IsTruncated>true</IsTruncated><NextContinuationToken>${next}</NextContinuationToken>`;
  return new Response(
    `<ListBucketResult>${contents.join("")}${tail}</ListBucketResult>`,
    {
      status: 200,
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(amzDate).mockReturnValue("20261123T040506Z");
  vi.mocked(authorization).mockReturnValue("AUTH");
  vi.mocked(sha256).mockReturnValue(EMPTY_DIGEST);
});

test("a listing asks the target for one prefix, signed with the canonical query, and returns its keys", async () => {
  const send = vi.fn<typeof fetch>(async () => page([KEY]));
  const admin = s3ObjectAdmin({
    target: pathStyle,
    credentials: READ,
    now: () => NOW,
    fetch: send,
  });
  expect(await admin.list("vps/")).toEqual([KEY]);
  expect(send).toHaveBeenCalledWith(
    "https://s3.example.com/backups/?list-type=2&prefix=vps%2F",
    {
      method: "GET",
      headers: {
        authorization: "AUTH",
        "x-amz-content-sha256": EMPTY_DIGEST,
        "x-amz-date": "20261123T040506Z",
      },
      signal: expect.any(AbortSignal),
    },
  );
  expect(authorization).toHaveBeenCalledWith(
    {
      method: "GET",
      path: "/backups/",
      query: "list-type=2&prefix=vps%2F",
      headers: {
        host: "s3.example.com",
        "x-amz-content-sha256": EMPTY_DIGEST,
        "x-amz-date": "20261123T040506Z",
      },
      payloadHash: EMPTY_DIGEST,
    },
    READ,
    { region: "eu-west-1", service: "s3" },
    "20261123T040506Z",
  );
});

test("a listing follows the continuation token across pages, with the query in canonical order", async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(page(["vps/a.sql.age"], "token-1"))
    .mockResolvedValueOnce(page(["vps/b.sql.age"]));
  const admin = s3ObjectAdmin({
    target: pathStyle,
    credentials: READ,
    now: () => NOW,
    fetch: send,
  });
  expect(await admin.list("vps/")).toEqual(["vps/a.sql.age", "vps/b.sql.age"]);
  expect(send.mock.calls.map(([url]) => url)).toEqual([
    "https://s3.example.com/backups/?list-type=2&prefix=vps%2F",
    "https://s3.example.com/backups/?continuation-token=token-1&list-type=2&prefix=vps%2F",
  ]);
});

test("a listing that says it is truncated but names no token is refused, not silently cut short", async () => {
  const truncated = new Response(
    "<ListBucketResult><Contents><Key>vps/a.sql.age</Key></Contents><IsTruncated>true</IsTruncated></ListBucketResult>",
    { status: 200 },
  );
  const admin = s3ObjectAdmin({
    target: pathStyle,
    credentials: READ,
    now: () => NOW,
    fetch: vi.fn<typeof fetch>(async () => truncated),
  });
  await expect(admin.list("vps/")).rejects.toThrow(
    "the listing of vps/ in backups is truncated but names no continuation token; nothing was deleted",
  );
});

test("a removal sends one signed DELETE to the object's key and reports nothing", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 204 }),
  );
  const admin = s3ObjectAdmin({
    target: pathStyle,
    credentials: READ,
    now: () => NOW,
    fetch: send,
  });
  await admin.remove(KEY);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    `https://s3.example.com/backups/${KEY}`,
    expect.objectContaining({ method: "DELETE" }),
  );
});

test("an object already absent is not an error, so a rerun of a prune finishes", async () => {
  const admin = s3ObjectAdmin({
    target: pathStyle,
    credentials: READ,
    now: () => NOW,
    fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })),
  });
  await expect(admin.remove(KEY)).resolves.toBeUndefined();
});

test("a refused removal names the key and status, and never the credential", async () => {
  const admin = s3ObjectAdmin({
    target: pathStyle,
    credentials: READ,
    now: () => NOW,
    fetch: vi.fn<typeof fetch>(
      async () => new Response("AccessDenied", { status: 403 }),
    ),
  });
  const failure = await admin.remove(KEY).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(
    `removing ${KEY} from backups failed with HTTP 403: AccessDenied`,
  );
  expect((failure as Error).message).not.toContain(READ.secretAccessKey);
});

test("a virtual-hosted target addresses the bucket in the host name, not the path", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 204 }),
  );
  const admin = s3ObjectAdmin({
    target: { ...pathStyle, pathStyle: false },
    credentials: READ,
    now: () => NOW,
    fetch: send,
  });
  await admin.remove(KEY);
  expect(send).toHaveBeenCalledWith(
    `https://backups.s3.example.com/${KEY}`,
    expect.anything(),
  );
});

import { beforeEach, expect, test, vi } from "vitest";
import { amzDate, authorization } from "./backup-sigv4.js";
import { ObjectExistsError, s3ObjectStore } from "./backup-s3.js";
import { sha256 } from "./export-manifest.js";

vi.mock("./backup-sigv4.js");
vi.mock("./export-manifest.js");

const KEY = "vps/golden-path/pg-main/app/2026-11-23T04-05-06Z.sql.age";
const BODY = Buffer.from("-----BEGIN AGE ENCRYPTED FILE-----\n");
const NOW = new Date("2026-11-23T04:05:06.000Z");
const CREDENTIALS = { accessKeyId: "AK", secretAccessKey: "SK" };

const pathStyle = {
  endpoint: "https://s3.example.com",
  bucket: "backups",
  region: "eu-west-1",
  pathStyle: true,
};

const fetchOk = () =>
  vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

beforeEach(() => {
  vi.mocked(amzDate).mockReturnValue("20261123T040506Z");
  vi.mocked(authorization).mockReturnValue("AUTH");
  vi.mocked(sha256).mockReturnValue("digest-of-the-body");
});

test("the object is written to the bucket under its key, signed, and only if it does not already exist", async () => {
  const fetch = fetchOk();
  const store = s3ObjectStore({
    target: pathStyle,
    credentials: CREDENTIALS,
    now: () => NOW,
    fetch,
  });
  await store.put(KEY, BODY, "application/octet-stream");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(`https://s3.example.com/backups/${KEY}`, {
    method: "PUT",
    body: BODY,
    headers: {
      authorization: "AUTH",
      "content-type": "application/octet-stream",
      "if-none-match": "*",
      "x-amz-content-sha256": "digest-of-the-body",
      "x-amz-date": "20261123T040506Z",
    },
    signal: expect.any(AbortSignal),
  });
});

test("the request is signed for the host it is sent to, with the payload digest and the region", async () => {
  const store = s3ObjectStore({
    target: pathStyle,
    credentials: CREDENTIALS,
    now: () => NOW,
    fetch: fetchOk(),
  });
  await store.put(KEY, BODY, "application/octet-stream");
  expect(sha256).toHaveBeenCalledWith(BODY);
  expect(authorization).toHaveBeenCalledWith(
    {
      method: "PUT",
      path: `/backups/${KEY}`,
      headers: {
        host: "s3.example.com",
        "content-type": "application/octet-stream",
        "if-none-match": "*",
        "x-amz-content-sha256": "digest-of-the-body",
        "x-amz-date": "20261123T040506Z",
      },
      payloadHash: "digest-of-the-body",
    },
    CREDENTIALS,
    { region: "eu-west-1", service: "s3" },
    "20261123T040506Z",
  );
});

test("a session token is sent and signed when the credentials carry one", async () => {
  const fetch = fetchOk();
  const store = s3ObjectStore({
    target: pathStyle,
    credentials: { ...CREDENTIALS, sessionToken: "TOKEN" },
    now: () => NOW,
    fetch,
  });
  await store.put(KEY, BODY, "application/octet-stream");
  expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
    "x-amz-security-token": "TOKEN",
  });
});

test("virtual-hosted addressing puts the bucket in the host name", async () => {
  const fetch = fetchOk();
  const store = s3ObjectStore({
    target: { ...pathStyle, pathStyle: false },
    credentials: CREDENTIALS,
    now: () => NOW,
    fetch,
  });
  await store.put(KEY, BODY, "application/octet-stream");
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
    `https://backups.s3.example.com/${KEY}`,
  );
});

test("an object that already exists is refused as ObjectExistsError and never sent twice", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 412 }),
  );
  const store = s3ObjectStore({
    target: pathStyle,
    credentials: CREDENTIALS,
    now: () => NOW,
    fetch,
  });
  const failure = store.put(KEY, BODY, "application/octet-stream");
  await expect(failure).rejects.toBeInstanceOf(ObjectExistsError);
  await expect(failure).rejects.toThrow(
    `${KEY} already exists in backups; a backup never overwrites an object, so this run is refused`,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("any other refusal fails the put with the status and the target's own words", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response("<Error>AccessDenied</Error>", { status: 403 }),
  );
  const store = s3ObjectStore({
    target: pathStyle,
    credentials: CREDENTIALS,
    now: () => NOW,
    fetch,
  });
  await expect(
    store.put(KEY, BODY, "application/octet-stream"),
  ).rejects.toThrow(
    `storing ${KEY} in backups failed with HTTP 403: <Error>AccessDenied</Error>`,
  );
});

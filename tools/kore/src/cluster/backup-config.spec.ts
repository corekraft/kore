import { expect, test } from "vitest";
import { backupConfigFromEnv } from "./backup-config.js";

const VALID = {
  KORE_BACKUP_ENDPOINT: "https://s3.example.com",
  KORE_BACKUP_BUCKET: "backups",
  KORE_BACKUP_REGION: "eu-west-1",
  KORE_BACKUP_PATH_STYLE: "true",
  KORE_BACKUP_KIND: "interim",
  AWS_ACCESS_KEY_ID: "AK",
  AWS_SECRET_ACCESS_KEY: "SK",
};

test("the target is read from the environment as typed config, with the write credential and the target kind", () => {
  expect(backupConfigFromEnv(VALID)).toEqual({
    target: {
      endpoint: "https://s3.example.com",
      bucket: "backups",
      region: "eu-west-1",
      pathStyle: true,
    },
    credentials: { accessKeyId: "AK", secretAccessKey: "SK" },
    kind: "interim",
  });
});

test("a session token is carried through only when one is set", () => {
  expect(
    backupConfigFromEnv({ ...VALID, AWS_SESSION_TOKEN: "TOKEN" }).credentials,
  ).toEqual({
    accessKeyId: "AK",
    secretAccessKey: "SK",
    sessionToken: "TOKEN",
  });
});

test("a missing endpoint is refused by its variable name, before any dump", () => {
  expect(() =>
    backupConfigFromEnv({ ...VALID, KORE_BACKUP_ENDPOINT: undefined }),
  ).toThrow(
    "KORE_BACKUP_ENDPOINT is not set; set the target's endpoint origin, for example https://s3.example.com",
  );
});

test("an endpoint that is not a URL is refused and the value is named", () => {
  expect(() =>
    backupConfigFromEnv({ ...VALID, KORE_BACKUP_ENDPOINT: "s3 box" }),
  ).toThrow('KORE_BACKUP_ENDPOINT is not a URL: "s3 box"');
});

test("a target kind other than interim or off-host is refused, so a report can never guess the kind", () => {
  expect(() =>
    backupConfigFromEnv({ ...VALID, KORE_BACKUP_KIND: "cloud" }),
  ).toThrow('KORE_BACKUP_KIND must be interim or off-host, not "cloud"');
});

test("addressing style must be stated, because it decides where the bucket name goes", () => {
  expect(() =>
    backupConfigFromEnv({ ...VALID, KORE_BACKUP_PATH_STYLE: undefined }),
  ).toThrow('KORE_BACKUP_PATH_STYLE must be "true" or "false"');
});

test("a missing write credential is refused by its variable name, never printed", () => {
  expect(() =>
    backupConfigFromEnv({ ...VALID, AWS_SECRET_ACCESS_KEY: "" }),
  ).toThrow(
    "AWS_SECRET_ACCESS_KEY is not set; the job needs its write-only credential from its secret",
  );
});

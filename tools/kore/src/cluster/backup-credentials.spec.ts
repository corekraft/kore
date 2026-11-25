import { expect, test } from "vitest";
import { credentialFromDocument } from "./backup-credentials.js";

const PATH = "/repo/infra/environments/vps/secrets/backup-write.enc.yaml";

/** The decrypted document sops prints as JSON for one backup credential Secret. */
function document(
  stringData: Record<string, unknown>,
  name = "backup-write",
  kind = "Secret",
): string {
  return JSON.stringify({
    apiVersion: "v1",
    kind,
    metadata: { name, namespace: "kore-backup" },
    type: "Opaque",
    stringData,
  });
}

test("a credential document yields its access key id, secret, and the namespace it names", () => {
  expect(
    credentialFromDocument(
      document({
        AWS_ACCESS_KEY_ID: "AKIA-EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "s3cr3t-example",
      }),
      "backup-write",
      PATH,
    ),
  ).toEqual({
    namespace: "kore-backup",
    credentials: {
      accessKeyId: "AKIA-EXAMPLE",
      secretAccessKey: "s3cr3t-example",
    },
  });
});

test("a document that is not a Secret of the expected name is refused, naming the document and the fix", () => {
  expect(() =>
    credentialFromDocument(
      document({ AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" }, "other"),
      "backup-write",
      PATH,
    ),
  ).toThrow(
    new Error(
      `${PATH} is not a Secret named backup-write; set kind and metadata.name with sops, then rerun`,
    ),
  );
  expect(() =>
    credentialFromDocument(
      document(
        { AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" },
        "backup-write",
        "ConfigMap",
      ),
      "backup-write",
      PATH,
    ),
  ).toThrow(
    new Error(
      `${PATH} is not a Secret named backup-write; set kind and metadata.name with sops, then rerun`,
    ),
  );
});

test("a document missing either key is refused, and the error names the key but never a value", () => {
  const text = document({ AWS_ACCESS_KEY_ID: "AKIA-KEEP-ME" });
  let message = "";
  try {
    credentialFromDocument(text, "backup-write", PATH);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toBe(
    `${PATH} has no stringData.AWS_SECRET_ACCESS_KEY; set that key with sops, then rerun`,
  );
  expect(message).not.toContain("AKIA-KEEP-ME");
});

test("a document with an empty key is refused as missing it", () => {
  expect(() =>
    credentialFromDocument(
      document({ AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "b" }),
      "backup-write",
      PATH,
    ),
  ).toThrow(
    new Error(
      `${PATH} has no stringData.AWS_ACCESS_KEY_ID; set that key with sops, then rerun`,
    ),
  );
});

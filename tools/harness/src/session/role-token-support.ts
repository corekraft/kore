import { generateKeyPairSync } from "node:crypto";
import type { FakeResponse } from "../runtime/runner-support.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** A throwaway App key: the PEM as the wizard stores it (base64) and its public half. */
export const APP_KEY = {
  stored: Buffer.from(
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
  ).toString("base64"),
  publicKey: pair.publicKey,
};

export const WRITER_TOKEN = "ghs_writer_installation_token_1";
export const JUDGE_TOKEN = "github_pat_judge_token_1";

/** The keychain as `security find-generic-password -w` shows it: one answer per service. */
export function keychain(items: Record<string, string>): FakeResponse[] {
  return Object.entries(items).map(([service, value]) => ({
    match: (c, a) =>
      c === "security" &&
      a[0] === "find-generic-password" &&
      a[a.indexOf("-s") + 1] === service,
    result: { stdout: `${value}\n` },
  }));
}

/** Everything the writer identity needs in the keychain. */
export const WRITER_ITEMS = {
  "kore.writer.app-id": "12345",
  "kore.writer.installation-id": "678",
  "kore.writer.private-key": APP_KEY.stored,
};

export const JUDGE_ITEMS = { "kore.judge.pat": JUDGE_TOKEN };

/** GitHub's answer to the installation token request. */
export const mintResponse: FakeResponse = {
  match: (c) => c === "curl",
  result: { stdout: JSON.stringify({ token: WRITER_TOKEN }) },
};

/** Without an identity item, `security` exits 44 as it does for a missing keychain entry. */
export const keychainMiss: FakeResponse = {
  match: (c) => c === "security",
  result: {
    code: 44,
    stderr:
      "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
  },
};

export const OVERLAY = "/repo/infra/environments/local/environment.yaml";

/** The local overlay with the role-tokens flag set. */
export const flag = (on: boolean): Record<string, string> => ({
  [OVERLAY]: JSON.stringify({ features: { "role-tokens": on } }),
});
export const FLAG_ON = flag(true);
